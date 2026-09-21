import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Typert from '@deepseek-ai/dsh-typert-registry'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import Runtime from '../../runtime/src/index.ts'
import FactoryStorage from '../../storage-sqlite/src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../tests/mock-adapter.ts'
import * as Workflows from '../src/index.ts'

/** Test deliberately selects full access; it never claims to verify OS confinement. */
class UnusedSandbox extends SandboxProvider {
  confine(): never { throw new Error('Full-access fixture must not request confinement') }
}

describe('Factory Demo Loader composition', () => {
  it('runs real Agent tools and a real script, preserving tool pairs in the task detail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lightcode-demo-'))
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(DefaultModel, { provider: 'mock', model: 'mock' })
      await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
      await ctx.plugin(UnusedSandbox)
      await ctx.plugin(LocalSubprocess)
      await ctx.plugin(Typert)
      const adapter = new MockAdapter([
        toolCallResponse('demo-call', 'example_numbers', {}),
        textResponse('```javascript\nconsole.log(JSON.stringify({ sum: 28 }))\n```'),
        [{ type: 'finish', reason: { kind: 'error', failure: { code: 'authentication', message: 'API key is missing' } } }],
      ])
      ctx.llm.registerAdapter(['mock'], adapter)
      ctx.tools.register(defineTool({ name: 'example_numbers', description: 'Return example numbers', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async () => '[2,3,5,7,11]',
      }))
      const configPath = join(root, 'cordis.yml')
      await writeFile(configPath, [
        '- name: factory-storage',
        '  config:',
        '    databasePath: ' + JSON.stringify(join(root, 'factory.sqlite3')),
        '- name: factory-runtime',
        '- name: factory-workflows',
        '  config:',
        '    artifactRoot: ' + JSON.stringify(join(root, 'artifacts')),
      ].join('\n'))
      ctx.baseUrl = pathToFileURL(root).href + '/'
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      const modules = new Map<string, unknown>([
        ['factory-storage', FactoryStorage], ['factory-runtime', Runtime], ['factory-workflows', Workflows],
      ])
      ctx.loader.internal = { version: 'v2', async import(name: string) {
        if (!modules.has(name)) throw new Error('Unexpected plugin: ' + name)
        return modules.get(name)
      } } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      expect((await ctx.lightcodeFactoryRuntime.catalog()).map(value => value.id).sort()).toEqual(['morning-script-demo', 'release-readiness'])
      const run = await ctx.lightcodeFactoryRuntime.start({ workflowId: 'morning-script-demo' })
      await vi.waitFor(async () => {
        const task = (await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs.find(value => value.id === run.id)
        expect({ status: task?.status, error: task?.error }).toEqual({ status: 'review', error: undefined })
      }, { timeout: 15000 })
      const task = (await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs[0]
      expect(task?.nodes.map(node => node.status)).toEqual(['completed', 'completed', 'completed'])
      expect(task?.nodes[2]?.output).toMatchObject({ stdout: '{"sum":28}\n', exitCode: 0, sandboxEnforcement: 'none' })
      const tools = task?.nodes[1]?.observations.filter(event => event.kind.startsWith('llm.tool-'))
      expect(tools?.map(event => ({ kind: event.kind, callId: event.callId }))).toEqual([
        { kind: 'llm.tool-call', callId: 'demo-call' }, { kind: 'llm.tool-result', callId: 'demo-call' },
      ])
      expect(tools?.[1]?.detail).toContain('[2,3,5,7,11]')
      expect(adapter.requests[0]?.model).toBe('mock')
      expect(task?.nodes[1]?.observations.find(event => event.kind === 'llm.request')?.detail).toContain('打印数组')
      await ctx.lightcodeFactoryRuntime.review({ runId: run.id, decision: 'complete' })
      expect((await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs[0]?.status).toBe('completed')
      const failed = await ctx.lightcodeFactoryRuntime.start({ workflowId: 'morning-script-demo' })
      await vi.waitFor(async () => {
        const task = await ctx.lightcodeFactoryRuntime.getRun({ runId: failed.id })
        expect(task.status).toBe('failed')
        expect(task.error).toContain('Check the current DSH model and API key configuration')
      }, { timeout: 15000 })
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Typert from '@deepseek-ai/dsh-typert-registry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Runtime from '../../runtime/src/index.ts'
import FactoryStorage from '../../storage-sqlite/src/index.ts'
import * as Workflows from '../src/index.ts'

describe('Release readiness workflow', () => {
  let root: string
  let ctx: Context

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lightcode-release-readiness-'))
    ctx = new Context()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  async function loadThroughLoader(): Promise<void> {
    await ctx.plugin(Typert)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: factory-storage',
      '  name: factory-storage',
      '  config:',
      '    databasePath: ' + JSON.stringify(join(root, 'factory.sqlite3')),
      '- id: factory-runtime',
      '  name: factory-runtime',
      '- id: factory-workflows',
      '  name: factory-workflows',
      '  config:',
      '    artifactRoot: ' + JSON.stringify(join(root, 'artifacts')),
      '    demoEnabled: false',
    ].join('\n'))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['factory-storage', FactoryStorage], ['factory-runtime', Runtime], ['factory-workflows', Workflows],
    ])
    ctx.loader.internal = { version: 'v2', async import(moduleName: string) {
      if (!modules.has(moduleName)) throw new Error('Unexpected plugin: ' + moduleName)
      return modules.get(moduleName)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
  }

  async function loadRuntime(): Promise<void> {
    await ctx.plugin(FactoryStorage, { databasePath: join(root, 'factory.sqlite3') })
    await ctx.plugin(Typert)
    await ctx.plugin(Runtime)
  }

  it('loads through the real Loader and completes the normal review path', async () => {
    await loadThroughLoader()

    const definition = (await ctx.lightcodeFactoryRuntime.catalog())[0]
    expect(definition?.id).toBe('release-readiness')
    expect(definition?.parameters.map(value => value.name)).toEqual(['project', 'version', 'riskNotes'])
    expect(definition?.parameters.find(value => value.name === 'riskNotes')?.label).toContain('不得包含凭据')
    expect(definition?.nodes.map(value => value.id)).toEqual(['normalize-input', 'assess-risk', 'build-checklist'])
    const run = await ctx.lightcodeFactoryRuntime.start({ workflowId: 'release-readiness', input: {
      project: '  billing-core  ', version: '2.4.0-rc.1',
      riskNotes: '包含数据迁移\n需要回滚预案',
    } })
    await vi.waitFor(async () => {
      const task = (await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs.find(value => value.id === run.id)
      expect({ status: task?.status, error: task?.error }).toEqual({ status: 'review', error: undefined })
    })
    const task = (await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs.find(value => value.id === run.id)
    expect(task?.nodes.map(value => value.id)).toEqual(['normalize-input', 'assess-risk', 'build-checklist'])
    expect(task?.nodes.map(value => value.status)).toEqual(['completed', 'completed', 'completed'])
    expect(task?.nodes[0]?.output).toMatchObject({
      project: 'billing-core', version: '2.4.0-rc.1', riskNoteCount: 2,
    })
    expect(task?.nodes[1]?.output).toMatchObject({ level: 'high', consideredNotes: 2 })
    expect(task?.nodes[2]?.output).toMatchObject({
      summary: { project: 'billing-core', version: '2.4.0-rc.1', riskLevel: 'high' },
    })
    const observations = task?.nodes.flatMap(value => value.observations) ?? []
    expect(observations.map(value => value.kind)).toEqual([
      'log', 'release.input', 'log', 'release.risk', 'log', 'release.checklist',
    ])
    expect(task?.events.map(value => value.type)).toEqual([
      'run.queued', 'run.started',
      'node.started', 'node.completed',
      'node.started', 'node.completed',
      'node.started', 'node.completed',
      'run.review',
    ])
    expect(task?.events.filter(value => value.type === 'node.started').map(value => value.nodeId)).toEqual([
      'normalize-input', 'assess-risk', 'build-checklist',
    ])
    await ctx.lightcodeFactoryRuntime.review({ runId: run.id, decision: 'complete' })
    expect((await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs.find(value => value.id === run.id)?.status).toBe('completed')
  }, 30000)

  it('rejects structural input errors and records business validation as a failed run', async () => {
    await loadThroughLoader()
    await expect(ctx.lightcodeFactoryRuntime.start({ workflowId: 'release-readiness' })).rejects.toThrow('Required parameter')
    await expect(ctx.lightcodeFactoryRuntime.start({ workflowId: 'release-readiness', input: {
      project: 'demo', version: '1.0.0', unexpected: 'x',
    } })).rejects.toThrow('Unknown parameter')

    const invalid = await ctx.lightcodeFactoryRuntime.start({ workflowId: 'release-readiness', input: {
      project: 'billing-core', version: 'latest', riskNotes: '',
    } })
    await vi.waitFor(async () => {
      const failed = (await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs.find(value => value.id === invalid.id)
      expect(failed?.status).toBe('failed')
    })
    const failed = (await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs.find(value => value.id === invalid.id)
    expect(failed?.nodes.map(value => value.status)).toEqual(['failed', 'pending', 'pending'])
    expect(failed?.events.some(value => value.type === 'run.review')).toBe(false)
  }, 30000)

  it('unregisters through the public Cordis plugin lifecycle', async () => {
    await loadRuntime()
    const plugin = ctx.plugin(Workflows, { artifactRoot: join(root, 'artifacts'), demoEnabled: false })
    await plugin
    expect((await ctx.lightcodeFactoryRuntime.catalog()).map(value => value.id)).toEqual(['release-readiness'])
    await plugin.dispose()
    expect(await ctx.lightcodeFactoryRuntime.catalog()).toEqual([])
  }, 30000)
})

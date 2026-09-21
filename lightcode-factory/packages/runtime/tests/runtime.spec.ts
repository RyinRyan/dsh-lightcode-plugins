import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Typert from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Runtime from '../src/index.ts'
import FactoryStorage from '../../storage-sqlite/src/index.ts'
import type { WorkflowRegistration } from 'lightcode-factory-contracts/workflow'
import { workflowRunSchema } from 'lightcode-factory-contracts/schema'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lightcode-runtime-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(FactoryStorage, { databasePath: join(root, 'factory.sqlite3') })
  await ctx.plugin(Typert)
  const fiber = ctx.plugin(Runtime, { maxConcurrentRuns: 1 })
  await fiber
  return { ctx, fiber, runtime: ctx.lightcodeFactoryRuntime }
}

const node = { id: 'report', name: 'Report' }
function workflow(execute: WorkflowRegistration['execute']): WorkflowRegistration {
  return { id: 'report', version: '1.0.0', name: 'Report', description: 'An independent business workflow',
    parameters: [{ name: 'subject', label: 'Subject', required: true }], nodes: [node], execute }
}

describe('Factory workflow protocol', () => {
  it('cancels an admission when its plugin unloads during the initial write', async () => {
    const { runtime } = await setup()
    const execute = vi.fn(async () => {})
    const dispose = runtime.registerWorkflow(workflow(execute))
    const admission = runtime.start({ workflowId: 'report', input: { subject: 'test' } })
    await dispose()
    expect((await admission).status).toBe('cancelled')
    expect(execute).not.toHaveBeenCalled()
    expect(await runtime.catalog()).toEqual([])
  })

  it('accepts a new business result without core changes, persists it and removes disposed registrations', async () => {
    const { ctx, runtime, fiber } = await setup()
    const plugin = ctx.plugin({ inject: ['lightcodeFactoryRuntime'], apply(ctx: Context) {
      ctx.effect(() => ctx.lightcodeFactoryRuntime.registerWorkflow(workflow(async (context) => {
        await context.node(node, async (task) => {
          await Promise.all([task.log('first'), task.log('second')])
          return { subject: context.input.subject ?? '', findings: [{ severity: 'low', line: 12 }], score: 98 }
        })
      })), 'test report workflow')
    } })
    await plugin
    await expect(runtime.start({ workflowId: 'report' })).rejects.toThrow('Required parameter')
    const run = await runtime.start({ workflowId: 'report', input: { subject: 'Example' } })
    await vi.waitFor(async () =>{  expect((await runtime.listRuns({ limit: 100 })).runs[0]?.status).toBe('review') })
    const result = (await runtime.listRuns({ limit: 100 })).runs[0]
    expect(result?.nodes[0]?.output).toEqual({ subject: 'Example', findings: [{ severity: 'low', line: 12 }], score: 98 })
    expect(result?.nodes[0]?.observations.map(event => event.detail)).toEqual(['first', 'second'])
    expect(result?.workflowVersion).toBe('1.0.0')
    expect(result?.events.map(event => event.type)).toMatchInlineSnapshot(`
      [
        "run.queued",
        "run.started",
        "node.started",
        "node.completed",
        "run.review",
      ]
    `)
    await runtime.review({ runId: run.id, decision: 'complete' })
    await plugin.dispose()
    expect(await runtime.catalog()).toEqual([])
    await fiber.dispose()
    await ctx.plugin(Runtime)
    expect((await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs[0]?.status).toBe('completed')
    expect((await ctx.lightcodeFactoryRuntime.listRuns({ limit: 100 })).runs[0]?.nodes[0]?.output).toEqual(result?.nodes[0]?.output)
  })

  it('keeps cancellation terminal when a non-cooperative node returns late', async () => {
    const { runtime } = await setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const dispose = runtime.registerWorkflow(workflow(async (context) => {
      await context.node(node, async () => { await gate; return { late: true } })
    }))
    const run = await runtime.start({ workflowId: 'report', input: { subject: 'test' } })
    await vi.waitFor(async () =>{  expect((await runtime.listRuns({ limit: 100 })).runs[0]?.nodes[0]?.status).toBe('running') })
    await runtime.cancel({ runId: run.id })
    release()
    await dispose()
    expect((await runtime.listRuns({ limit: 100 })).runs[0]?.status).toBe('cancelled')
    expect((await runtime.listRuns({ limit: 100 })).runs[0]?.nodes[0]?.output).toBeUndefined()
    expect((await runtime.listRuns({ limit: 100 })).runs[0]?.events.some(event => event.type === 'node.completed')).toBe(false)
  })

  it('does not turn a swallowed node error into successful review', async () => {
    const { runtime } = await setup()
    runtime.registerWorkflow(workflow(async (context) => {
      try { await context.node(node, () => Promise.reject(new Error('Business failure'))) }
      catch (error) { void error /* Deliberately simulate a plugin swallowing failure. */ }
    }))
    await runtime.start({ workflowId: 'report', input: { subject: 'test' } })
    await vi.waitFor(async () =>{  expect((await runtime.listRuns({ limit: 100 })).runs[0]?.status).toBe('failed') })
    expect((await runtime.listRuns({ limit: 100 })).runs[0]?.error).toBe('Business failure')
  })

  it('rejects non-JSON node output and unknown input fields', async () => {
    const { runtime } = await setup()
    runtime.registerWorkflow(workflow(async (context) => { await context.node(node, async () => ({ score: Infinity })) }))
    await expect(runtime.start({ workflowId: 'report', input: { unexpected: 'x' } })).rejects.toThrow('Unknown parameter')
    await runtime.start({ workflowId: 'report', input: { subject: 'test' } })
    await vi.waitFor(async () =>{  expect((await runtime.listRuns({ limit: 100 })).runs[0]?.status).toBe('failed') })
  })

  it('persists a one-time schedule and releases it only after the due time', async () => {
    const { runtime } = await setup()
    const execute = vi.fn(async (context) => {
      await context.node(node, async () => ({ ready: true }))
    })
    runtime.registerWorkflow(workflow(execute))
    const scheduledFor = new Date(Date.now() + 180).toISOString()
    const created = await runtime.start({ workflowId: 'report', input: { subject: 'scheduled' }, scheduledFor })

    expect(created).toMatchObject({ status: 'queued', scheduledFor })
    expect(created.events.map(event => event.type)).toEqual(['run.scheduled'])
    expect(execute).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect((await runtime.getRun({ runId: created.id })).status).toBe('review')
    }, { timeout: 2_000 })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not execute a future schedule even if it enters the runnable queue early', async () => {
    const { runtime } = await setup()
    const execute = vi.fn(async (context) => {
      await context.node(node, async () => ({ ready: true }))
    })
    runtime.registerWorkflow(workflow(execute))
    const scheduledFor = new Date(Date.now() + 300).toISOString()
    const created = await runtime.start({ workflowId: 'report', input: { subject: 'guarded' }, scheduledFor })

    ;(runtime as unknown as { enqueueRun(runId: string): void }).enqueueRun(created.id)
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(execute).not.toHaveBeenCalled()
    expect(await runtime.getRun({ runId: created.id })).toMatchObject({ status: 'queued', scheduledFor })
    await vi.waitFor(async () => {
      expect((await runtime.getRun({ runId: created.id })).status).toBe('review')
    }, { timeout: 2_000 })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('cancels a scheduled run without executing it', async () => {
    const { runtime } = await setup()
    const execute = vi.fn(async () => {})
    runtime.registerWorkflow(workflow(execute))
    const created = await runtime.start({
      workflowId: 'report', input: { subject: 'cancelled' },
      scheduledFor: new Date(Date.now() + 180).toISOString(),
    })

    const cancelled = await runtime.cancel({ runId: created.id })
    expect(cancelled.status).toBe('cancelled')
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(execute).not.toHaveBeenCalled()
    expect((await runtime.getRun({ runId: created.id })).status).toBe('cancelled')
  })

  it('recovers a durable schedule after the runtime restarts', async () => {
    const { ctx, runtime, fiber } = await setup()
    const firstExecute = vi.fn(async () => {})
    runtime.registerWorkflow(workflow(firstExecute))
    const created = await runtime.start({
      workflowId: 'report', input: { subject: 'restart' },
      scheduledFor: new Date(Date.now() + 300).toISOString(),
    })

    await fiber.dispose()
    expect(firstExecute).not.toHaveBeenCalled()
    const nextFiber = ctx.plugin(Runtime, { maxConcurrentRuns: 1 })
    await nextFiber
    const nextExecute = vi.fn(async (context) => {
      await context.node(node, async () => ({ recovered: true }))
    })
    ctx.lightcodeFactoryRuntime.registerWorkflow(workflow(nextExecute))

    await vi.waitFor(async () => {
      expect((await ctx.lightcodeFactoryRuntime.getRun({ runId: created.id })).status).toBe('review')
    }, { timeout: 2_000 })
    expect(nextExecute).toHaveBeenCalledTimes(1)
  })

  it('keeps a scheduled run durable while its workflow plugin is unloaded', async () => {
    const { runtime } = await setup()
    const firstExecute = vi.fn(async () => {})
    const dispose = runtime.registerWorkflow(workflow(firstExecute))
    const created = await runtime.start({
      workflowId: 'report', input: { subject: 'reload' },
      scheduledFor: new Date(Date.now() + 250).toISOString(),
    })

    await dispose()
    expect((await runtime.getRun({ runId: created.id })).status).toBe('queued')
    expect(firstExecute).not.toHaveBeenCalled()
    const nextExecute = vi.fn(async (context) => {
      await context.node(node, async () => ({ reloaded: true }))
    })
    runtime.registerWorkflow(workflow(nextExecute))
    await vi.waitFor(async () => {
      expect((await runtime.getRun({ runId: created.id })).status).toBe('review')
    }, { timeout: 2_000 })
    expect(nextExecute).toHaveBeenCalledTimes(1)
  })

  it('fails a recovered schedule rather than running it with a different workflow version', async () => {
    const { ctx, runtime, fiber } = await setup()
    runtime.registerWorkflow(workflow(async () => {}))
    const created = await runtime.start({
      workflowId: 'report', input: { subject: 'old version' },
      scheduledFor: new Date(Date.now() + 500).toISOString(),
    })
    await fiber.dispose()

    const nextFiber = ctx.plugin(Runtime, { maxConcurrentRuns: 1 })
    await nextFiber
    const execute = vi.fn(async () => {})
    ctx.lightcodeFactoryRuntime.registerWorkflow({ ...workflow(execute), version: '2.0.0' })
    await vi.waitFor(async () => {
      expect((await ctx.lightcodeFactoryRuntime.getRun({ runId: created.id })).status).toBe('failed')
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an invalid or non-future schedule', async () => {
    const { runtime } = await setup()
    runtime.registerWorkflow(workflow(async () => {}))
    await expect(runtime.start({ workflowId: 'report', input: { subject: 'invalid' }, scheduledFor: 'later' }))
      .rejects.toThrow('Scheduled time is invalid')
    await expect(runtime.start({ workflowId: 'report', input: { subject: 'past' }, scheduledFor: new Date(0).toISOString() }))
      .rejects.toThrow('Scheduled time must be in the future')
  })

  it('rejects pre-0.3 aggregates and malformed cursors', async () => {
    expect(() => workflowRunSchema.parse({ id: 'old' })).toThrow()
    const { runtime } = await setup()
    await expect(runtime.listRuns({ cursor: 'not-a-cursor' })).rejects.toThrow('Invalid run cursor')
  })
})

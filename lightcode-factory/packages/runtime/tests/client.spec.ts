import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunView } from 'lightcode-factory-contracts/types'
import { LightcodeFactoryClient } from '../src/client/index.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

const run: WorkflowRunView = {
  id: 'one', workflowId: 'report', workflowVersion: '1.0.0', input: {}, name: 'Report', status: 'queued',
  createdAt: '2026-09-18T01:00:00.000Z', updatedAt: '2026-09-18T01:00:00.000Z', nodes: [], events: [],
}

describe('Factory browser client', () => {
  it('omits scheduledFor for immediate runs and sends it for scheduled runs', async () => {
    const ctx = new Context()
    cleanup.push(() => ctx.fiber.dispose())
    const start = vi.fn(async () => ({ ok: true as const, value: run }))
    const remote = {
      catalog: vi.fn(async () => ({ ok: true as const, value: [] })),
      listRuns: vi.fn(async () => ({ ok: true as const, value: { runs: [] } })),
      getRun: vi.fn(), start, cancel: vi.fn(), review: vi.fn(),
    }
    const client = new LightcodeFactoryClient(ctx, remote as never)

    await client.start('report', { subject: 'now' })
    expect(start).toHaveBeenLastCalledWith({ workflowId: 'report', input: { subject: 'now' } })
    const scheduledFor = '2099-01-02T03:04:00.000Z'
    await client.start('report', { subject: 'later' }, scheduledFor)
    expect(start).toHaveBeenLastCalledWith({
      workflowId: 'report', input: { subject: 'later' }, scheduledFor,
    })
  })
})

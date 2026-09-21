import { describe, expect, it } from 'vitest'
import { factoryRemote } from '../src/remote.ts'
import { workflowRunSchema } from '../src/schema.ts'

describe('Factory contracts', () => {
  it('requires the 0.3 aggregate fields instead of accepting legacy records', () => {
    const base = {
      id: 'one', workflowId: 'release-readiness', name: 'Release readiness', status: 'queued',
      createdAt: '2026-09-18T01:00:00.000Z', updatedAt: '2026-09-18T01:00:00.000Z',
      nodes: [], events: [],
    }
    expect(() => workflowRunSchema.parse(base)).toThrow()
    expect(workflowRunSchema.parse({
      ...base, workflowVersion: '1.0.0', input: {}, scheduledFor: '2026-09-19T01:00:00.000Z',
    })).toMatchObject({ id: 'one', scheduledFor: '2026-09-19T01:00:00.000Z' })
    expect(() => workflowRunSchema.parse({
      ...base, workflowVersion: '1.0.0', input: {}, scheduledFor: 'tomorrow',
    })).toThrow()
  })

  it('publishes only the bounded version 2 remote operations', () => {
    expect(factoryRemote.package).toBe('lightcode-factory-runtime')
    expect(factoryRemote.descriptors.map(value => value.id)).toEqual([
      'lightcode-factory-runtime#factory/catalog',
      'lightcode-factory-runtime#factory/listRuns',
      'lightcode-factory-runtime#factory/getRun',
      'lightcode-factory-runtime#factory/start',
      'lightcode-factory-runtime#factory/cancel',
      'lightcode-factory-runtime#factory/review',
    ])
  })
})

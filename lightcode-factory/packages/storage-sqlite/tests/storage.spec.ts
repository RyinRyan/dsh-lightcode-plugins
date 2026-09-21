import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowRunView } from 'lightcode-factory-contracts/types'
import { SqliteWorkflowRunRepository } from '../src/sqlite-run-repository.ts'

const cleanup: string[] = []
afterEach(async () => {
  for (const path of cleanup.splice(0).reverse()) await rm(path, { recursive: true, force: true })
})

function run(id: string, status: WorkflowRunView['status'] = 'queued', minute = 0, scheduledFor?: string): WorkflowRunView {
  const at = `2026-09-18T01:${String(minute).padStart(2, '0')}:00.000Z`
  return {
    id, workflowId: 'release-readiness', workflowVersion: '1.0.0', input: { project: 'factory' },
    name: 'Release readiness', status, createdAt: at, updatedAt: at,
    nodes: [{ id: 'prepare', name: 'Prepare', status: 'pending', observations: [] }],
    events: [{ sequence: 1, at, type: 'run.queued', message: 'queued' }],
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
  }
}

async function temporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), 'lightcode-storage-'))
  cleanup.push(root)
  const databasePath = join(root, 'factory.sqlite3')
  const repository = new SqliteWorkflowRunRepository(databasePath)
  await repository.open()
  return { root, databasePath, repository }
}

describe('SQLite workflow run repository', () => {
  it('round-trips aggregates and rejects stale revisions without partial writes', async () => {
    const { repository } = await temporaryRepository()
    const created = await repository.createRun(run('one'))
    const completed: WorkflowRunView = {
      ...created.run, status: 'review', updatedAt: '2026-09-18T01:01:00.000Z',
      nodes: [{ ...created.run.nodes[0]!, status: 'completed', output: { score: 98 },
        observations: [{ at: '2026-09-18T01:00:30.000Z', kind: 'log', title: 'Log', detail: 'done' }] }],
      events: [...created.run.events, { sequence: 2, at: '2026-09-18T01:01:00.000Z', type: 'run.review', message: 'review' }],
    }
    const saved = await repository.saveRun(completed, created.revision)
    await expect(repository.saveRun({ ...completed, status: 'completed' }, created.revision)).rejects.toThrow('revision conflict')
    expect(await repository.getRun('one')).toEqual(saved)
    repository.close()
  })

  it('uses bounded seek pagination and status filters', async () => {
    const { databasePath, repository } = await temporaryRepository()
    await repository.createRun(run('old', 'completed', 0))
    await repository.createRun(run('middle', 'running', 1))
    await repository.createRun(run('new', 'queued', 2))

    const first = await repository.listRuns({ limit: 2 })
    expect(first.runs.map(value => value.id)).toEqual(['new', 'middle'])
    expect(first.nextCursor).toEqual({ createdAt: run('middle', 'running', 1).createdAt, id: 'middle' })
    const second = await repository.listRuns({ limit: 2, before: first.nextCursor })
    expect(second.runs.map(value => value.id)).toEqual(['old'])
    expect(second.nextCursor).toBeUndefined()
    expect((await repository.listRuns({ limit: 10, statuses: ['running'] })).runs.map(value => value.id)).toEqual(['middle'])
    await expect(repository.listRuns({ limit: 101 })).rejects.toThrow('limit')

    repository.close()
    const database = new DatabaseSync(databasePath)
    const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
      .map(value => String((value as { name: string }).name))
    expect(indexes).toContain('factory_runs_created_idx')
    expect(indexes).toContain('factory_runs_status_created_idx')
    database.close()
  })

  it('queries interrupted runs in creation order', async () => {
    const { repository } = await temporaryRepository()
    await repository.createRun(run('queued', 'queued', 0))
    await repository.createRun(run('running', 'running', 1))
    await repository.createRun(run('done', 'completed', 2))
    expect((await repository.listInterruptedRuns()).map(value => value.run.id)).toEqual(['queued', 'running'])
    repository.close()
  })

  it('round-trips the durable scheduled time', async () => {
    const { repository } = await temporaryRepository()
    const scheduledFor = '2026-09-19T01:00:00.000Z'
    await repository.createRun(run('scheduled', 'queued', 0, scheduledFor))
    expect((await repository.getRun('scheduled'))?.run.scheduledFor).toBe(scheduledFor)
    repository.close()
  })

  it('migrates a version 1 database in place without losing runs', async () => {
    const { databasePath, repository } = await temporaryRepository()
    await repository.createRun(run('legacy'))
    repository.close()

    const legacy = new DatabaseSync(databasePath)
    legacy.exec('ALTER TABLE factory_runs DROP COLUMN scheduled_for')
    legacy.exec('DELETE FROM factory_schema_migrations WHERE version = 2')
    legacy.exec('PRAGMA user_version = 1')
    legacy.close()

    const migrated = new SqliteWorkflowRunRepository(databasePath)
    await migrated.open()
    expect((await migrated.getRun('legacy'))?.run.id).toBe('legacy')
    migrated.close()
    const inspected = new DatabaseSync(databasePath)
    expect((inspected.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    expect(inspected.prepare('PRAGMA table_info(factory_runs)').all()
      .map(value => String((value as { name: string }).name))).toContain('scheduled_for')
    inspected.close()
  })

  it('creates a consistent non-overwriting backup that can be reopened', async () => {
    const { root, repository } = await temporaryRepository()
    await repository.createRun(run('backup-source', 'completed', 3))
    const destination = join(root, 'backups', 'factory.sqlite3')
    await repository.createBackup(destination)
    await expect(repository.createBackup(destination)).rejects.toThrow('already exists')
    repository.close()

    const restored = new SqliteWorkflowRunRepository(destination)
    await restored.open()
    expect((await restored.listRuns({ limit: 10 })).runs.map(value => value.id)).toEqual(['backup-source'])
    restored.close()
  })
})

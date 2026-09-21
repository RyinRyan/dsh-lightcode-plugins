import { access, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type {
  StoredWorkflowRun, StoredWorkflowRunPage, WorkflowRunQuery, WorkflowRunRepository,
} from 'lightcode-factory-contracts/repository'
import { parseWorkflowRun } from 'lightcode-factory-contracts/schema'
import type {
  WorkflowNodeObservation, WorkflowNodeRun, WorkflowRunEvent, WorkflowRunStatus, WorkflowRunView,
} from 'lightcode-factory-contracts/types'

type SqlRow = Record<string, unknown>

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS factory_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS factory_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','review','completed','cancelled','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  scheduled_for TEXT,
  current_node_id TEXT,
  error TEXT,
  revision INTEGER NOT NULL CHECK (revision > 0)
) STRICT;
CREATE INDEX IF NOT EXISTS factory_runs_created_idx ON factory_runs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS factory_runs_status_created_idx ON factory_runs(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS factory_runs_workflow_created_idx ON factory_runs(workflow_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS factory_run_nodes (
  run_id TEXT NOT NULL REFERENCES factory_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','cancelled','failed')),
  started_at TEXT,
  finished_at TEXT,
  output_json TEXT,
  error TEXT,
  PRIMARY KEY (run_id, node_id),
  UNIQUE (run_id, ordinal)
) STRICT;
CREATE TABLE IF NOT EXISTS factory_run_events (
  run_id TEXT NOT NULL REFERENCES factory_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  node_id TEXT,
  PRIMARY KEY (run_id, sequence)
) STRICT;
CREATE TABLE IF NOT EXISTS factory_node_observations (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  call_id TEXT,
  session_id TEXT,
  PRIMARY KEY (run_id, node_id, ordinal),
  FOREIGN KEY (run_id, node_id) REFERENCES factory_run_nodes(run_id, node_id) ON DELETE CASCADE
) STRICT;
`
const CURRENT_SCHEMA_VERSION = 2

/** SQLite infrastructure adapter for the Runtime-owned run repository port. */
export class SqliteWorkflowRunRepository implements WorkflowRunRepository {
  private database?: DatabaseSync

  constructor(private readonly databasePath: string) {}

  async open(): Promise<void> {
    if (this.database !== undefined) return
    await mkdir(dirname(this.databasePath), { recursive: true })
    const database = new DatabaseSync(this.databasePath, { timeout: 5000 })
    this.database = database
    try {
      database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;')
      const existing = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factory_runs'").get()
      const userVersion = Number((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      if ((existing === undefined && userVersion !== 0)
        || (existing !== undefined && ![1, CURRENT_SCHEMA_VERSION].includes(userVersion))) {
        throw new Error('Unsupported Factory SQLite schema; create a new 0.4 database or restore a 0.4 backup')
      }
      this.transaction(() => {
        if (existing === undefined) database.exec(INITIAL_SCHEMA)
        else if (userVersion === 1) database.exec('ALTER TABLE factory_runs ADD COLUMN scheduled_for TEXT')
        else database.exec(INITIAL_SCHEMA)
        database.prepare('INSERT OR IGNORE INTO factory_schema_migrations(version, applied_at) VALUES (?, ?)')
          .run(1, new Date().toISOString())
        database.prepare('INSERT OR IGNORE INTO factory_schema_migrations(version, applied_at) VALUES (?, ?)')
          .run(CURRENT_SCHEMA_VERSION, new Date().toISOString())
        database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`)
      })
    } catch (error) {
      database.close()
      this.database = undefined
      throw error
    }
  }

  close(): void {
    this.database?.close()
    this.database = undefined
  }

  async listRuns(query: WorkflowRunQuery): Promise<StoredWorkflowRunPage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error('run page limit must be between 1 and 100')
    const allowed = new Set<WorkflowRunStatus>(['queued', 'running', 'review', 'completed', 'cancelled', 'failed'])
    if (query.statuses?.some(status => !allowed.has(status))) throw new Error('invalid run status filter')
    if (query.statuses?.length === 0) return { runs: [] }
    const where: string[] = []
    const parameters: (string | number)[] = []
    if (query.before !== undefined) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))')
      parameters.push(query.before.createdAt, query.before.createdAt, query.before.id)
    }
    if (query.statuses !== undefined) {
      where.push(`status IN (${query.statuses.map(() => '?').join(',')})`)
      parameters.push(...query.statuses)
    }
    parameters.push(query.limit + 1)
    const sql = `SELECT id, created_at FROM factory_runs${where.length === 0 ? '' : ' WHERE ' + where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`
    const rows = this.db.prepare(sql).all(...parameters) as SqlRow[]
    const pageRows = rows.slice(0, query.limit)
    const runs = pageRows.map(row => this.readAggregate(String(row.id)).run)
    const last = pageRows.at(-1)
    return {
      runs,
      ...(rows.length <= query.limit || last === undefined ? {} : {
        nextCursor: { createdAt: String(last.created_at), id: String(last.id) },
      }),
    }
  }

  async listInterruptedRuns(): Promise<readonly StoredWorkflowRun[]> {
    const rows = this.db.prepare("SELECT id FROM factory_runs WHERE status IN ('queued','running') ORDER BY created_at, id").all() as SqlRow[]
    return rows.map(row => this.readAggregate(String(row.id)))
  }

  async getRun(runId: string): Promise<StoredWorkflowRun | undefined> {
    const row = this.db.prepare('SELECT id FROM factory_runs WHERE id = ?').get(runId) as SqlRow | undefined
    return row === undefined ? undefined : this.readAggregate(runId)
  }

  async createRun(value: WorkflowRunView): Promise<StoredWorkflowRun> {
    const run = parseWorkflowRun(value)
    this.transaction(() => {
      const existing = this.db.prepare('SELECT 1 AS present FROM factory_runs WHERE id = ?').get(run.id)
      if (existing !== undefined) throw new Error(`workflow run '${run.id}' already exists`)
      this.insertRun(run, 1)
      this.replaceNodes(run)
      this.appendEvents(run.events, run.id)
    })
    return { run: structuredClone(run), revision: 1 }
  }

  async saveRun(value: WorkflowRunView, expectedRevision: number): Promise<StoredWorkflowRun> {
    const run = parseWorkflowRun(value)
    const revision = expectedRevision + 1
    this.transaction(() => {
      const result = this.db.prepare(`UPDATE factory_runs SET
        workflow_id = ?, workflow_version = ?, input_json = ?, name = ?, status = ?, created_at = ?, updated_at = ?,
        scheduled_for = ?, current_node_id = ?, error = ?, revision = ? WHERE id = ? AND revision = ?`).run(
        run.workflowId, run.workflowVersion, JSON.stringify(run.input),
        run.name, run.status, run.createdAt, run.updatedAt, run.scheduledFor ?? null,
        run.currentNodeId ?? null, run.error ?? null,
        revision, run.id, expectedRevision,
      )
      if (Number(result.changes) !== 1) throw new Error(`workflow run '${run.id}' revision conflict`)
      this.replaceNodes(run)
      this.appendEvents(run.events, run.id)
    })
    return { run: structuredClone(run), revision }
  }

  async createBackup(destinationPath: string): Promise<void> {
    const source = resolve(this.databasePath)
    const destination = resolve(destinationPath)
    if (source === destination) throw new Error('backup destination must differ from the active database')
    await mkdir(dirname(destination), { recursive: true })
    try {
      await access(destination)
      throw new Error(`backup destination already exists: ${destination}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await backup(this.db, destination)
  }

  private get db(): DatabaseSync {
    if (this.database === undefined) throw new Error('lightcode factory storage is not initialized')
    return this.database
  }

  private transaction<T>(execute: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = execute()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve the original failure */ }
      throw error
    }
  }

  private insertRun(run: WorkflowRunView, revision: number): void {
    this.db.prepare(`INSERT INTO factory_runs(
      id, workflow_id, workflow_version, input_json, name, status, created_at, updated_at,
      scheduled_for, current_node_id, error, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      run.id, run.workflowId, run.workflowVersion, JSON.stringify(run.input),
      run.name, run.status, run.createdAt, run.updatedAt, run.scheduledFor ?? null,
      run.currentNodeId ?? null, run.error ?? null, revision,
    )
  }

  private replaceNodes(run: WorkflowRunView): void {
    this.db.prepare('DELETE FROM factory_run_nodes WHERE run_id = ?').run(run.id)
    const insertNode = this.db.prepare(`INSERT INTO factory_run_nodes(
      run_id, node_id, ordinal, name, status, started_at, finished_at, output_json, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const insertObservation = this.db.prepare(`INSERT INTO factory_node_observations(
      run_id, node_id, ordinal, at, kind, title, detail, call_id, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    run.nodes.forEach((node, nodeOrdinal) => {
      insertNode.run(run.id, node.id, nodeOrdinal, node.name, node.status, node.startedAt ?? null, node.finishedAt ?? null,
        node.output === undefined ? null : JSON.stringify(node.output), node.error ?? null)
      node.observations.forEach((observation, ordinal) => insertObservation.run(
        run.id, node.id, ordinal, observation.at, observation.kind, observation.title, observation.detail,
        observation.callId ?? null, observation.sessionId ?? null,
      ))
    })
  }

  private appendEvents(events: readonly WorkflowRunEvent[], runId: string): void {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO factory_run_events(
      run_id, sequence, at, type, message, node_id
    ) VALUES (?, ?, ?, ?, ?, ?)`)
    for (const event of events) insert.run(runId, event.sequence, event.at, event.type, event.message, event.nodeId ?? null)
  }

  private readAggregate(runId: string): StoredWorkflowRun {
    const row = this.db.prepare('SELECT * FROM factory_runs WHERE id = ?').get(runId) as SqlRow | undefined
    if (row === undefined) throw new Error(`workflow run '${runId}' does not exist`)
    const nodeRows = this.db.prepare('SELECT * FROM factory_run_nodes WHERE run_id = ? ORDER BY ordinal').all(runId) as SqlRow[]
    const observations = this.db.prepare('SELECT * FROM factory_node_observations WHERE run_id = ? ORDER BY node_id, ordinal').all(runId) as SqlRow[]
    const byNode = new Map<string, WorkflowNodeObservation[]>()
    for (const item of observations) {
      const nodeId = String(item.node_id)
      const values = byNode.get(nodeId) ?? []
      values.push({ at: String(item.at), kind: String(item.kind), title: String(item.title), detail: String(item.detail),
        ...(item.call_id === null ? {} : { callId: String(item.call_id) }),
        ...(item.session_id === null ? {} : { sessionId: String(item.session_id) }) })
      byNode.set(nodeId, values)
    }
    const nodes: WorkflowNodeRun[] = nodeRows.map(item => ({
      id: String(item.node_id), name: String(item.name), status: item.status as WorkflowNodeRun['status'],
      observations: byNode.get(String(item.node_id)) ?? [],
      ...(item.started_at === null ? {} : { startedAt: String(item.started_at) }),
      ...(item.finished_at === null ? {} : { finishedAt: String(item.finished_at) }),
      ...(item.output_json === null ? {} : { output: JSON.parse(String(item.output_json)) }),
      ...(item.error === null ? {} : { error: String(item.error) }),
    }))
    const events = (this.db.prepare('SELECT * FROM factory_run_events WHERE run_id = ? ORDER BY sequence').all(runId) as SqlRow[])
      .map((item): WorkflowRunEvent => ({ sequence: Number(item.sequence), at: String(item.at), type: String(item.type),
        message: String(item.message), ...(item.node_id === null ? {} : { nodeId: String(item.node_id) }) }))
    const run = parseWorkflowRun({
      id: String(row.id), workflowId: String(row.workflow_id), name: String(row.name), status: row.status,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), nodes, events,
      workflowVersion: String(row.workflow_version), input: JSON.parse(String(row.input_json)),
      ...(row.scheduled_for === null ? {} : { scheduledFor: String(row.scheduled_for) }),
      ...(row.current_node_id === null ? {} : { currentNodeId: String(row.current_node_id) }),
      ...(row.error === null ? {} : { error: String(row.error) }),
    })
    return { run, revision: Number(row.revision) }
  }

}

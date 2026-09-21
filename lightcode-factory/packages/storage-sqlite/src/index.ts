import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  StoredWorkflowRun, StoredWorkflowRunPage, WorkflowRunQuery, WorkflowRunRepository,
} from 'lightcode-factory-contracts/repository'
import type { WorkflowRunView } from 'lightcode-factory-contracts/types'
import { SqliteWorkflowRunRepository } from './sqlite-run-repository.ts'

export interface Config {
  /** Local SQLite database file. Use a persistent local volume in production. */
  databasePath: string
}

/** Cordis-owned lifecycle wrapper for the Factory run repository. */
export class LightcodeFactorySqliteStorage extends Service implements WorkflowRunRepository {
  static Config: z<Config> = z.object({
    databasePath: z.string().required(),
  })
  private repository?: SqliteWorkflowRunRepository

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'lightcodeFactoryRunRepository')
  }

  protected async [Service.init](): Promise<void> {
    const repository = new SqliteWorkflowRunRepository(this.config.databasePath)
    await repository.open()
    this.repository = repository
    this.ctx.effect(() => () => {
      repository.close()
      this.repository = undefined
    }, 'lightcode factory storage: close sqlite')
  }

  listRuns(query: WorkflowRunQuery): Promise<StoredWorkflowRunPage> { return this.value.listRuns(query) }
  listInterruptedRuns(): Promise<readonly StoredWorkflowRun[]> { return this.value.listInterruptedRuns() }
  getRun(runId: string): Promise<StoredWorkflowRun | undefined> { return this.value.getRun(runId) }
  createRun(run: WorkflowRunView): Promise<StoredWorkflowRun> { return this.value.createRun(run) }
  saveRun(run: WorkflowRunView, expectedRevision: number): Promise<StoredWorkflowRun> {
    return this.value.saveRun(run, expectedRevision)
  }
  createBackup(destinationPath: string): Promise<void> { return this.value.createBackup(destinationPath) }

  private get value(): SqliteWorkflowRunRepository {
    if (this.repository === undefined) throw new Error('lightcode factory storage is not initialized')
    return this.repository
  }
}

export { SqliteWorkflowRunRepository } from './sqlite-run-repository.ts'
export default LightcodeFactorySqliteStorage

import type { WorkflowRunStatus, WorkflowRunView } from './types.ts'

/** Durable run plus the storage revision used for compare-and-swap updates. */
export interface StoredWorkflowRun {
  readonly run: WorkflowRunView
  readonly revision: number
}

/** Stable seek key for descending creation-time pagination. */
export interface WorkflowRunCursor {
  readonly createdAt: string
  readonly id: string
}

/** Storage-side bounded query. */
export interface WorkflowRunQuery {
  readonly limit: number
  readonly before?: WorkflowRunCursor
  readonly statuses?: readonly WorkflowRunStatus[]
}

/** Repository page with a structured continuation key. */
export interface StoredWorkflowRunPage {
  readonly runs: readonly WorkflowRunView[]
  readonly nextCursor?: WorkflowRunCursor
}

/** Host-only persistence port. Runtime owns state transitions; adapters only store and query aggregates. */
export interface WorkflowRunRepository {
  listRuns(query: WorkflowRunQuery): Promise<StoredWorkflowRunPage>
  listInterruptedRuns(): Promise<readonly StoredWorkflowRun[]>
  getRun(runId: string): Promise<StoredWorkflowRun | undefined>
  createRun(run: WorkflowRunView): Promise<StoredWorkflowRun>
  saveRun(run: WorkflowRunView, expectedRevision: number): Promise<StoredWorkflowRun>
  createBackup(destinationPath: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context { lightcodeFactoryRunRepository: WorkflowRunRepository }
}

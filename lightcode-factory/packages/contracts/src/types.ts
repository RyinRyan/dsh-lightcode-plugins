/** Shared JSON-safe Factory protocol. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
/** Runtime-owned task states mapped to the six board lanes. */
export type WorkflowRunStatus = 'queued' | 'running' | 'review' | 'completed' | 'cancelled' | 'failed'
/** Execution state of one declared workflow node. */
export type WorkflowNodeStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
/** JSON result returned by a completed node. */
export type WorkflowNodeOutput = JsonValue
/** Task form fields contributed by a workflow. */
export interface WorkflowParameter {
  readonly name: string
  readonly label: string
  readonly required: boolean
  readonly defaultValue?: string
}
/** Stable node identity and human-readable label, ordered by registration. */
export interface WorkflowNodeDefinition { readonly id: string; readonly name: string }
/** Host-only execute functions never cross the transport. */
export interface WorkflowDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  readonly parameters: readonly WorkflowParameter[]
  readonly nodes: readonly WorkflowNodeDefinition[]
}
/** Bounded execution fact; call and session identifiers correlate native Agent activity. */
export interface WorkflowNodeObservation {
  readonly at: string
  readonly kind: string
  readonly title: string
  readonly detail: string
  readonly callId?: string
  readonly sessionId?: string
}
/** Persisted node state, output and retained observation tail. */
export interface WorkflowNodeRun extends WorkflowNodeDefinition {
  readonly status: WorkflowNodeStatus
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly output?: WorkflowNodeOutput
  readonly observations: readonly WorkflowNodeObservation[]
  readonly error?: string
}
/** Ordered task lifecycle event; sequence numbers are task-local. */
export interface WorkflowRunEvent {
  readonly sequence: number
  readonly at: string
  readonly type: string
  readonly message: string
  readonly nodeId?: string
}
/** Complete durable task aggregate. */
export interface WorkflowRunView {
  readonly id: string
  readonly workflowId: string
  readonly workflowVersion: string
  readonly input: Readonly<Record<string, string>>
  readonly name: string
  readonly status: WorkflowRunStatus
  readonly createdAt: string
  readonly updatedAt: string
  /** Optional UTC instant at which a queued run becomes eligible for execution. */
  readonly scheduledFor?: string
  readonly currentNodeId?: string
  readonly nodes: readonly WorkflowNodeRun[]
  readonly events: readonly WorkflowRunEvent[]
  readonly error?: string
}
/** Opaque-cursor page used by the Browser API. */
export interface WorkflowRunPage {
  readonly runs: readonly WorkflowRunView[]
  readonly nextCursor?: string
}
/** Bounded run query. Runtime applies defaults and validates cursor/status values. */
export interface WorkflowRunListRequest {
  readonly limit?: number
  readonly cursor?: string
  readonly statuses?: readonly WorkflowRunStatus[]
}
/** Task creation request; scheduledFor is omitted for immediate execution. */
export interface WorkflowStartRequest {
  readonly workflowId: string
  readonly input?: Readonly<Record<string, string>>
  readonly scheduledFor?: string
}
/** Identifier of an existing persisted task. */
export interface WorkflowRunRequest { readonly runId: string }
/** Human decision for a task awaiting review. */
export interface WorkflowReviewRequest { readonly runId: string; readonly decision: 'complete' | 'cancel' }

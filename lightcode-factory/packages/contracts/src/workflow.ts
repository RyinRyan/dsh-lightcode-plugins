/** In-process protocol between workflow plugins and the Factory Runtime. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { WorkflowDefinition, WorkflowNodeDefinition, WorkflowNodeObservation } from './types.ts'

/** Runtime-owned reporting capability valid only while this node is running. */
export interface WorkflowNodeContext {
  readonly signal: AbortSignal
  report(event: Omit<WorkflowNodeObservation, 'at'>): Promise<void>
  log(message: string): Promise<void>
}

/** Workflow authors await each node; parallel and detached nodes are rejected. */
export interface WorkflowExecutionContext {
  readonly runId: string
  readonly input: Readonly<Record<string, string>>
  readonly signal: AbortSignal
  node<T extends JsonValue>(
    definition: WorkflowNodeDefinition,
    execute: (context: WorkflowNodeContext) => Promise<T>,
  ): Promise<T>
}

/** Registration is removed on plugin disposal; accepted runs retain this implementation. */
export interface WorkflowRegistration extends WorkflowDefinition {
  execute(this: void, context: WorkflowExecutionContext): Promise<void>
}

/** Registration port implemented by the Factory Runtime and consumed by Workflow plugins. */
export interface WorkflowRuntime {
  registerWorkflow(registration: WorkflowRegistration): () => Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context { lightcodeFactoryRuntime: WorkflowRuntime }
}

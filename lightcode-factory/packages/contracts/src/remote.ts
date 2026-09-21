/** Version 2 wire contract: bounded list queries and explicit detail reads. */
import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorkflowDefinition, WorkflowReviewRequest, WorkflowRunListRequest, WorkflowRunPage,
  WorkflowRunRequest, WorkflowRunView, WorkflowStartRequest,
} from './types.ts'
import { workflowRunSchema } from './schema.ts'

const definition = z.object({
  id: z.string(), name: z.string(), description: z.string(), version: z.string(),
  parameters: z.array(z.object({ name: z.string(), label: z.string(), required: z.boolean(), defaultValue: z.string().optional() })),
  nodes: z.array(z.object({ id: z.string(), name: z.string() })),
})
const catalog: z.ZodType<readonly WorkflowDefinition[]> = z.array(definition)
const listRequest: z.ZodType<WorkflowRunListRequest> = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(1024).optional(),
  statuses: z.array(z.enum(['queued', 'running', 'review', 'completed', 'cancelled', 'failed'])).max(6).optional(),
})
const page: z.ZodType<WorkflowRunPage> = z.object({ runs: z.array(workflowRunSchema), nextCursor: z.string().optional() })
const start: z.ZodType<WorkflowStartRequest> = z.object({
  workflowId: z.string(), input: z.record(z.string(), z.string()).optional(),
  scheduledFor: z.string().max(64).datetime().optional(),
})
const run: z.ZodType<WorkflowRunRequest> = z.object({ runId: z.string() })
const review: z.ZodType<WorkflowReviewRequest> = z.object({ runId: z.string(), decision: z.enum(['complete', 'cancel']) })

function route(method: string, result: z.ZodType, request?: z.ZodType): InvocationDescriptor {
  return {
    id: 'lightcode-factory-runtime#factory/' + method,
    service: 'lightcodeFactoryRuntime', namespace: 'factory', method,
    invocation: { kind: 'direct' },
    parameters: request ? [{ name: 'request', wire: 'request', source: 'json', codec: {
      mode: 'strict', typeSymbol: 'lightcode-factory-contracts#' + method + 'Request', schema: request,
    } }] : [],
    result: { mode: 'strict', typeSymbol: 'lightcode-factory-contracts#' + method + 'Result', schema: result },
  }
}

export interface FactoryRemote {
  catalog(): Promise<RemoteResult<readonly WorkflowDefinition[]>>
  listRuns(request: WorkflowRunListRequest): Promise<RemoteResult<WorkflowRunPage>>
  getRun(request: WorkflowRunRequest): Promise<RemoteResult<WorkflowRunView>>
  start(request: WorkflowStartRequest): Promise<RemoteResult<WorkflowRunView>>
  cancel(request: WorkflowRunRequest): Promise<RemoteResult<WorkflowRunView>>
  review(request: WorkflowReviewRequest): Promise<RemoteResult<WorkflowRunView>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { factory: FactoryRemote }
}

export const factoryRemote: TypertRemoteContribution = {
  package: 'lightcode-factory-runtime',
  descriptors: [
    route('catalog', catalog), route('listRuns', page, listRequest), route('getRun', workflowRunSchema, run),
    route('start', workflowRunSchema, start), route('cancel', workflowRunSchema, run),
    route('review', workflowRunSchema, review),
  ],
}

export default factoryRemote

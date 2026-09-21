import { z } from 'zod'
import type { WorkflowRunView } from './types.ts'


/** Runtime schema for one persisted workflow run. */
export const workflowRunSchema = z.object({
  id: z.string(), workflowId: z.string(), name: z.string(),
  workflowVersion: z.string(), input: z.record(z.string(), z.string()),
  status: z.enum(['queued', 'running', 'review', 'completed', 'cancelled', 'failed']),
  createdAt: z.string(), updatedAt: z.string(), scheduledFor: z.string().datetime().optional(),
  currentNodeId: z.string().optional(), error: z.string().optional(),
  nodes: z.array(z.object({
    id: z.string(), name: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'cancelled', 'failed']),
    observations: z.array(z.object({
      at: z.string(),
      kind: z.string(),
      title: z.string(),
      detail: z.string(),
      callId: z.string().optional(), sessionId: z.string().optional(),
    })).default([]),
    startedAt: z.string().optional(), finishedAt: z.string().optional(), output: z.json().optional(), error: z.string().optional(),
  })),
  events: z.array(z.object({
    sequence: z.number().int().positive(), at: z.string(), type: z.string(), message: z.string(), nodeId: z.string().optional(),
  })),
})

/** Parse one authoritative persisted aggregate at storage and migration boundaries. */
export function parseWorkflowRun(value: unknown): WorkflowRunView {
  return (workflowRunSchema as z.ZodType<WorkflowRunView>).parse(value)
}

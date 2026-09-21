/** Persistent application-workflow runtime and plugin registration seam. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as jsonSchema } from 'zod'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { factoryRemote } from 'lightcode-factory-contracts/remote'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { WorkflowRegistration, WorkflowExecutionContext, WorkflowNodeContext } from 'lightcode-factory-contracts/workflow'
import type { StoredWorkflowRun, WorkflowRunCursor, WorkflowRunRepository } from 'lightcode-factory-contracts/repository'
import type {
  WorkflowDefinition, WorkflowNodeDefinition, WorkflowNodeObservation, WorkflowStartRequest, WorkflowRunRequest, WorkflowReviewRequest,
  WorkflowRunEvent, WorkflowRunListRequest, WorkflowRunPage, WorkflowRunView,
} from 'lightcode-factory-contracts/types'

/** Deployment choices for the durable workflow runtime. */
export interface Config {
  /** Maximum number of workflow runs executing simultaneously. */
  maxConcurrentRuns?: number
  /** Maximum serialized node output size. */
  maxOutputBytes?: number
  /** Maximum durable execution facts retained for each workflow node. */
  maxNodeObservations?: number
  /** Maximum characters retained in one execution fact. */
  maxObservationChars?: number
}

type ResolvedConfig = Required<Config>
const DEFAULT_MAX_CONCURRENT_RUNS = 2
const DEFAULT_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_MAX_NODE_OBSERVATIONS = 128
const DEFAULT_MAX_OBSERVATION_CHARS = 16 * 1024
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Host service for durable tasks and complete workflow registrations. */
export class LightcodeFactoryRuntime extends TypertRemoteService {
  static inject = ['lightcodeFactoryRunRepository', 'typert']
  static Config: z<Config> = z.object({
    maxConcurrentRuns: z.natural().min(1).max(32).default(DEFAULT_MAX_CONCURRENT_RUNS),
    maxOutputBytes: z.natural().min(1024).max(4 * 1024 * 1024).default(DEFAULT_OUTPUT_BYTES),
    maxNodeObservations: z.natural().min(1).max(1024).default(DEFAULT_MAX_NODE_OBSERVATIONS),
    maxObservationChars: z.natural().min(128).max(256 * 1024).default(DEFAULT_MAX_OBSERVATION_CHARS),
  })

  private readonly definitions = new Map<string, WorkflowRegistration>()
  private readonly accepted = new Map<string, WorkflowRegistration>()
  private readonly tasks = new Map<string, Promise<void>>()
  private readonly admissions = new Set<Promise<unknown>>()
  private readonly mutations = new Map<string, Promise<unknown>>()
  private stopped = false
  private readonly subscribers = new Set<() => void>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly queuedIds: string[] = []
  private readonly scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly recoverableScheduled = new Map<string, StoredWorkflowRun>()
  private activeCount = 0
  private pumping = false
  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx, 'lightcodeFactoryRuntime', { namespace: 'factory' })
    this.config = config as ResolvedConfig
  }

  /** Register the wire contract and reconcile runs that survived a host restart. */
  protected async [Service.init](): Promise<void> {
    this.ctx.effect(() => this.ctx.typert.register({
      package: factoryRemote.package, face: 'host', schemas: [],
      invocations: factoryRemote.descriptors,
      model: { services: [], events: [], objects: [] },
    }), 'factory: wire contract')
    this.ctx.effect(() => async () => {
      this.stopped = true
      for (const timer of this.scheduledTimers.values()) clearTimeout(timer)
      this.scheduledTimers.clear()
      await Promise.allSettled(this.admissions)
      for (const controller of this.controllers.values()) controller.abort(new Error('Runtime stopped'))
      await Promise.allSettled(this.tasks.values())
      await Promise.allSettled(this.mutations.values())
    }, 'lightcode factory: drain runtime work')
    for (const stored of await this.repository.listInterruptedRuns()) {
      const run = stored.run
      if (run.status === 'queued' && run.scheduledFor !== undefined) {
        this.recoverableScheduled.set(run.id, stored)
        continue
      }
      await this.save(this.appendEvent(this.clearCurrentNode({ ...run, status: 'failed', updatedAt: this.now(), error: 'Host restarted during execution' }), 'run.failed', 'DSH 重启导致执行中断'), stored.revision)
    }
    this.pump()
  }

  private get repository(): WorkflowRunRepository { return this.ctx.lightcodeFactoryRunRepository }

  /** Register a complete workflow; disposal cancels and drains its tasks.
   * @param registration - metadata and execution callback.
   * @returns disposer owned by the registering plugin.
   */
  registerWorkflow(registration: WorkflowRegistration): () => Promise<void> {
    if (!registration.id || !registration.version || registration.nodes.length === 0) throw new Error('Workflow requires id, version and nodes')
    if (this.definitions.has(registration.id)) throw new Error('Duplicate workflow: ' + registration.id)
    const ids = registration.nodes.map(node => node.id)
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('Duplicate or empty node id')
    const fields = registration.parameters.map(field => field.name)
    if (fields.some(field => !field) || new Set(fields).size !== fields.length) throw new Error('Duplicate or empty parameter name')
    const captured = { ...structuredClone(this.metadata(registration)), execute: registration.execute }
    this.definitions.set(captured.id, captured)
    const recovery = this.recoverScheduledRuns(captured)
    this.admissions.add(recovery)
    void recovery.then(
      () => { this.admissions.delete(recovery) },
      (error: unknown) => {
        this.admissions.delete(recovery)
        this.ctx.logger.error('Factory scheduled recovery failed', error)
      },
    )
    return async () => {
      this.definitions.delete(captured.id)
      await Promise.allSettled(this.admissions)
      const ids = [...this.accepted].filter(([, value]) => value === captured).map(([id]) => id)
      for (const runId of ids) {
        const stored = await this.repository.getRun(runId)
        if (stored?.run.status === 'queued' && stored.run.scheduledFor !== undefined) {
          this.clearScheduledTimer(runId)
          this.removeQueuedId(runId)
          this.accepted.delete(runId)
          this.recoverableScheduled.set(runId, stored)
        } else if (stored !== undefined && ['queued', 'running'].includes(stored.run.status)) {
          await this.cancel({ runId })
        }
      }
      await Promise.allSettled(ids.flatMap((id) => {
        const task = this.tasks.get(id)
        return task === undefined ? [] : [task]
      }))
    }
  }

  private metadata(value: WorkflowRegistration): WorkflowDefinition {
    const { id, name, description, version, nodes, parameters } = value
    return { id, name, description, version, nodes, parameters }
  }

  private async recoverScheduledRuns(registration: WorkflowRegistration): Promise<void> {
    for (const [runId, candidate] of this.recoverableScheduled) {
      if (candidate.run.workflowId !== registration.id) continue
      const stored = await this.repository.getRun(runId)
      if (this.stopped || this.definitions.get(registration.id) !== registration) return
      if (stored?.run.status !== 'queued' || stored.run.scheduledFor === undefined) {
        this.recoverableScheduled.delete(runId)
        continue
      }
      this.recoverableScheduled.delete(runId)
      if (stored.run.workflowVersion !== registration.version) {
        const message = `Scheduled workflow version ${stored.run.workflowVersion} is unavailable`
        await this.update(runId, run => this.appendEvent({ ...run, status: 'failed', error: message,
          nodes: run.nodes.map(node => node.status === 'pending' ? { ...node, status: 'failed', error: message } : node),
        }, 'run.failed', message))
        continue
      }
      this.accepted.set(runId, registration)
      this.armScheduledRun(runId, stored.run.scheduledFor)
    }
  }

  /** Read the installed workflow catalog. */
  async catalog(): Promise<readonly WorkflowDefinition[]> {
    return [...this.definitions.values()].map(value => structuredClone(this.metadata(value)))
  }

  /** Read one bounded page of durable runs. */
  async listRuns(request: WorkflowRunListRequest = {}): Promise<WorkflowRunPage> {
    const page = await this.repository.listRuns({
      limit: request.limit ?? 60,
      ...(request.cursor === undefined ? {} : { before: this.decodeCursor(request.cursor) }),
      ...(request.statuses === undefined ? {} : { statuses: request.statuses }),
    })
    return {
      runs: page.runs.map(run => structuredClone(run)),
      ...(page.nextCursor === undefined ? {} : { nextCursor: this.encodeCursor(page.nextCursor) }),
    }
  }

  /** Read the latest aggregate for a detail view. */
  async getRun(request: WorkflowRunRequest): Promise<WorkflowRunView> {
    const stored = await this.repository.getRun(request.runId)
    if (stored === undefined) throw new Error('Unknown run: ' + request.runId)
    return structuredClone(stored.run)
  }

  /** Subscribe to durable task writes.
   * @param listener - synchronous observer; exceptions are logged and contained.
   * @returns Function removing the observer.
   */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => { this.subscribers.delete(listener) }
  }

  /** Queue one registered workflow.
   * @param request - workflow identifier and declared text inputs.
   * @returns Persisted task; cancelled if its plugin unloads during admission.
   */
  async start(request: WorkflowStartRequest): Promise<WorkflowRunView> {
    const admission = this.queueRun(request)
    this.admissions.add(admission)
    try { return await admission } finally { this.admissions.delete(admission) }
  }

  private async queueRun(request: WorkflowStartRequest): Promise<WorkflowRunView> {
    const { workflowId, input = {} } = request
    this.assertAcceptingTasks()
    const definition = this.definitions.get(workflowId)
    if (definition === undefined) throw new Error(`workflow '${workflowId}' is not registered`)
    const fields = new Map(definition.parameters.map(field => [field.name, field]))
    for (const key of Object.keys(input)) if (!fields.has(key)) throw new Error('Unknown parameter: ' + key)
    const resolved: Record<string, string> = {}
    for (const field of fields.values()) {
      const value = input[field.name] ?? field.defaultValue ?? ''
      if (field.required && !value.trim()) throw new Error('Required parameter: ' + field.label)
      Object.defineProperty(resolved, field.name, { value, enumerable: true })
    }
    const at = this.now()
    const scheduledFor = this.normalizeScheduledFor(request.scheduledFor, at)
    const run: WorkflowRunView = {
      id: randomUUID(), workflowId, workflowVersion: definition.version, input: resolved, name: definition.name, status: 'queued', createdAt: at, updatedAt: at,
      nodes: definition.nodes.map(node => ({ ...node, status: 'pending', observations: [] })),
      events: [{ sequence: 1, at, type: scheduledFor === undefined ? 'run.queued' : 'run.scheduled',
        message: scheduledFor === undefined ? '工作流已进入待调度队列' : `工作流计划于 ${scheduledFor} 执行` }],
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
    }
    await this.repository.createRun(run)
    this.publish()
    // A plugin can unload while the initial durable write is in flight.
    if (this.stopped || this.definitions.get(workflowId) !== definition) return this.cancel({ runId: run.id })
    this.accepted.set(run.id, definition)
    if (scheduledFor === undefined) this.enqueueRun(run.id)
    else this.armScheduledRun(run.id, scheduledFor)
    return structuredClone(run)
  }

  /** Cancel a task before notifying its workflow's AbortSignal.
   * @param request - identifier of a queued, running or review-pending task.
   * @returns Persisted cancellation; rejects for other terminal states.
   */
  async cancel(request: WorkflowRunRequest): Promise<WorkflowRunView> {
    return this.cancelFrom(request.runId, ['queued', 'running', 'review'])
  }

  private async cancelFrom(runId: string, allowed: readonly WorkflowRunView['status'][]): Promise<WorkflowRunView> {
    const cancelled = await this.update(runId, (run) => {
      if (!allowed.includes(run.status)) throw new Error('Cannot cancel task in ' + run.status)
      const at = this.now()
      return this.appendEvent(this.clearCurrentNode({ ...run, status: 'cancelled', updatedAt: at,
        nodes: run.nodes.map(node => ['pending', 'running'].includes(node.status)
          ? { ...node, status: 'cancelled', finishedAt: at } : node),
      }), 'run.cancelled', '工作流已取消')
    })
    this.clearScheduledTimer(runId)
    this.recoverableScheduled.delete(runId)
    this.removeQueuedId(runId)
    this.controllers.get(runId)?.abort(new Error('Cancelled by user'))
    if (!this.tasks.has(runId)) this.accepted.delete(runId)
    return structuredClone(cancelled)
  }

  /** Apply the final human decision.
   * @param request - review-pending task identifier and decision.
   * @returns Persisted terminal task; rejects unless awaiting review.
   */
  async review(request: WorkflowReviewRequest): Promise<WorkflowRunView> {
    const { runId, decision } = request
    if (decision === 'cancel') {
      return this.cancelFrom(runId, ['review'])
    }
    return structuredClone(await this.update(runId, (run) => {
      if (run.status !== 'review') throw new Error('Task is not waiting for review')
      return this.appendEvent({ ...run, status: 'completed', updatedAt: this.now() }, 'run.completed', '评审通过，工作流已完成')
    }))
  }

  private normalizeScheduledFor(value: string | undefined, now: string): string | undefined {
    if (value === undefined) return undefined
    if (value.length > 64) throw new Error('Scheduled time is invalid')
    const timestamp = Date.parse(value)
    if (Number.isNaN(timestamp)) throw new Error('Scheduled time is invalid')
    if (timestamp <= Date.parse(now)) throw new Error('Scheduled time must be in the future')
    return new Date(timestamp).toISOString()
  }

  private enqueueRun(runId: string): void {
    this.clearScheduledTimer(runId)
    this.recoverableScheduled.delete(runId)
    if (!this.queuedIds.includes(runId)) this.queuedIds.push(runId)
    this.pump()
  }

  private armScheduledRun(runId: string, scheduledFor: string): void {
    this.clearScheduledTimer(runId)
    if (this.stopped) return
    const remaining = Date.parse(scheduledFor) - Date.now()
    if (remaining <= 0) {
      this.enqueueRun(runId)
      return
    }
    const timer = setTimeout(() => {
      if (this.scheduledTimers.get(runId) !== timer) return
      this.scheduledTimers.delete(runId)
      void this.releaseScheduledRun(runId).catch((error: unknown) => {
        this.ctx.logger.error('Factory scheduled release failed', error)
      })
    }, Math.min(remaining, MAX_TIMER_DELAY_MS))
    ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
    this.scheduledTimers.set(runId, timer)
  }

  private async releaseScheduledRun(runId: string): Promise<void> {
    if (this.stopped) return
    const stored = await this.repository.getRun(runId)
    if (stored?.run.status !== 'queued' || stored.run.scheduledFor === undefined) {
      this.accepted.delete(runId)
      return
    }
    const registration = this.accepted.get(runId)
    if (registration === undefined) {
      this.recoverableScheduled.set(runId, stored)
      return
    }
    if (Date.parse(stored.run.scheduledFor) > Date.now()) {
      this.armScheduledRun(runId, stored.run.scheduledFor)
      return
    }
    this.enqueueRun(runId)
  }

  private clearScheduledTimer(runId: string): void {
    const timer = this.scheduledTimers.get(runId)
    if (timer !== undefined) clearTimeout(timer)
    this.scheduledTimers.delete(runId)
  }

  private removeQueuedId(runId: string): void {
    let index = this.queuedIds.indexOf(runId)
    while (index !== -1) {
      this.queuedIds.splice(index, 1)
      index = this.queuedIds.indexOf(runId)
    }
  }

  private pump(): void {
    if (this.pumping) return
    this.pumping = true
    void this.drainQueue().finally(() => {
      this.pumping = false
      if (!this.stopped && this.activeCount < this.config.maxConcurrentRuns && this.queuedIds.length > 0) this.pump()
    })
  }

  private async drainQueue(): Promise<void> {
    while (!this.stopped && this.activeCount < this.config.maxConcurrentRuns && this.queuedIds.length > 0) {
      const runId = this.queuedIds.shift()
      if (runId === undefined) break
      const registration = this.accepted.get(runId)
      const stored = await this.repository.getRun(runId)
      if (!registration || stored?.run.status !== 'queued') continue
      if (stored.run.scheduledFor !== undefined && Date.parse(stored.run.scheduledFor) > Date.now()) {
        this.armScheduledRun(runId, stored.run.scheduledFor)
        continue
      }
      this.activeCount++
      const task = this.execute(runId, registration).catch((error: unknown) => {
        this.ctx.logger.error('Factory persistence failure', error)
      }).finally(() => {
        this.activeCount--
        this.accepted.delete(runId)
        this.tasks.delete(runId)
        this.pump()
      })
      this.tasks.set(runId, task)
    }
  }

  private async execute(runId: string, registration: WorkflowRegistration): Promise<void> {
    const controller = new AbortController()
    const { signal } = controller
    this.controllers.set(runId, controller)
    let index = 0
    let pending: Promise<JsonValue> | undefined
    let nodeFailure: Error | undefined
    try {
      await this.update(runId, (run) => {
        if (run.status !== 'queued') throw new Error('Task is no longer queued')
        return this.appendEvent({ ...run, status: 'running' }, 'run.started', '工作流开始执行')
      })
      const stored = await this.requireRun(runId)
      const context: WorkflowExecutionContext = {
        runId, input: structuredClone(stored.run.input ?? {}), signal,
        node: <T extends JsonValue>(definition: WorkflowNodeDefinition, execute: (node: WorkflowNodeContext) => Promise<T>) => {
          signal.throwIfAborted()
          if (pending) throw new Error('Await each node before starting another')
          const expected = registration.nodes[index]
          if (expected?.id !== definition.id || expected.name !== definition.name) throw new Error('Unexpected node: ' + definition.id)
          index++
          const task = this.executeNode(runId, definition, signal, execute)
          pending = task
          void task.then(() => { pending = undefined }, (error: unknown) => {
            nodeFailure = error instanceof Error ? error : new Error(String(error))
            pending = undefined
          })
          return task
        },
      }
      await registration.execute(context)
      if (pending) throw new Error('Workflow returned before its node completed')
      if (nodeFailure !== undefined) throw nodeFailure
      signal.throwIfAborted()
      if (index !== registration.nodes.length) throw new Error('Workflow skipped declared nodes')
      await this.update(runId, run => run.status === 'running'
        ? this.appendEvent(this.clearCurrentNode({ ...run, status: 'review' }), 'run.review', '全部节点已完成，等待评审') : run)
    } catch (error: unknown) {
      controller.abort(error)
      if (pending) await Promise.allSettled([pending])
      await this.update(runId, (run) => {
        if (run.status === 'cancelled') return run
        const message = error instanceof Error ? error.message : String(error)
        const at = this.now()
        return this.appendEvent(this.clearCurrentNode({ ...run, status: 'failed', error: message,
          nodes: run.nodes.map(node => node.status === 'running'
            ? { ...node, status: 'failed', error: message, finishedAt: at } : node),
        }), 'run.failed', message, run.currentNodeId)
      })
    } finally {
      this.controllers.delete(runId)
    }
  }

  private async executeNode<T extends JsonValue>(
    runId: string, definition: WorkflowNodeDefinition, signal: AbortSignal,
    execute: (context: WorkflowNodeContext) => Promise<T>,
  ): Promise<T> {
    const nodeId = definition.id
    await this.update(runId, (run) => {
      this.assertRunning(run, signal)
      return this.appendEvent({ ...run, currentNodeId: nodeId,
        nodes: run.nodes.map(node => node.id === nodeId ? { ...node, status: 'running', startedAt: this.now() } : node),
      }, 'node.started', '开始执行：' + definition.name, nodeId)
    })
    const report = (event: Omit<WorkflowNodeObservation, 'at'>) => this.reportObservation(runId, nodeId, signal, event)
    const output = await execute({ signal, report, log: message => report({ kind: 'log', title: '日志', detail: message }) })
    signal.throwIfAborted()
    const parsed = jsonSchema.json().parse(output)
    if (Buffer.byteLength(JSON.stringify(parsed)) > this.config.maxOutputBytes) throw new Error('Node output exceeds size limit')
    await this.update(runId, (run) => {
      this.assertRunning(run, signal)
      return this.appendEvent({ ...run, nodes: run.nodes.map(node => node.id === nodeId
        ? { ...node, status: 'completed', output: parsed, finishedAt: this.now() } : node),
      }, 'node.completed', '执行完成：' + definition.name, nodeId)
    })
    return output
  }

  private assertRunning(run: WorkflowRunView, signal: AbortSignal): void {
    signal.throwIfAborted()
    if (run.status !== 'running') throw new Error('Task is no longer running')
  }

  private update(id: string, change: (run: WorkflowRunView) => WorkflowRunView): Promise<WorkflowRunView> {
    const previous = this.mutations.get(id) ?? Promise.resolve()
    const task = previous.catch((error: unknown) => {
      // The previous caller observes its rejection; later commands still run.
      void error
    }).then(async () => {
      const stored = await this.requireRun(id)
      const next = { ...change(stored.run), updatedAt: this.now() }
      return (await this.save(next, stored.revision)).run
    })
    this.mutations.set(id, task)
    void task.finally(() => {
      if (this.mutations.get(id) === task) this.mutations.delete(id)
    }).catch((error: unknown) => { void error /* Original caller receives this rejection. */ })
    return task
  }

  private appendEvent(run: WorkflowRunView, type: string, message: string, nodeId?: string): WorkflowRunView {
    const event: WorkflowRunEvent = {
      sequence: run.events.length + 1, at: this.now(), type, message, ...(nodeId === undefined ? {} : { nodeId }),
    }
    return { ...run, events: [...run.events, event] }
  }

  private async reportObservation(
    runId: string, nodeId: string, signal: AbortSignal, observation: Omit<WorkflowNodeObservation, 'at'>,
  ): Promise<void> {
    await this.update(runId, (run) => {
      this.assertRunning(run, signal)
      if (run.nodes.find(node => node.id === nodeId)?.status !== 'running') throw new Error('Node has finished')
      const detail = observation.detail.length <= this.config.maxObservationChars ? observation.detail
        : observation.detail.slice(0, this.config.maxObservationChars) + '\\n[truncated]'
      const event = { ...observation, title: observation.title.slice(0, 512), detail, at: this.now() }
      return { ...run, nodes: run.nodes.map(node => node.id === nodeId
        ? { ...node, observations: [...node.observations, event].slice(-this.config.maxNodeObservations) } : node) }
    })
  }

  private clearCurrentNode(run: WorkflowRunView): WorkflowRunView {
    const copy = { ...run }
    delete copy.currentNodeId
    return copy
  }

  private async requireRun(runId: string): Promise<StoredWorkflowRun> {
    const stored = await this.repository.getRun(runId)
    if (stored === undefined) throw new Error(`workflow run '${runId}' does not exist`)
    return stored
  }

  private async save(run: WorkflowRunView, expectedRevision: number): Promise<StoredWorkflowRun> {
    const stored = await this.repository.saveRun(run, expectedRevision)
    this.publish()
    return stored
  }

  private publish(): void {
    for (const subscriber of this.subscribers) {
      try { subscriber() } catch (error) { this.ctx.logger.warn('Factory observer failed', error) }
    }
  }
  private now(): string { return new Date().toISOString() }

  private assertAcceptingTasks(): void {
    if (this.stopped) throw new Error('Runtime is stopping')
  }

  private encodeCursor(cursor: WorkflowRunCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(value: string): WorkflowRunCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
      if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('createdAt')
      if (typeof parsed.id !== 'string' || parsed.id.length === 0) throw new Error('id')
      return { createdAt: parsed.createdAt, id: parsed.id }
    } catch {
      throw new Error('Invalid run cursor')
    }
  }
}

export default LightcodeFactoryRuntime

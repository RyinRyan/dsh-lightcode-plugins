/** Browser-side bounded projection and command facade. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { factoryRemote } from 'lightcode-factory-contracts/remote'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkflowDefinition, WorkflowRunView } from 'lightcode-factory-contracts/types'

export interface FactoryClientSnapshot {
  readonly definitions: readonly WorkflowDefinition[]
  readonly runs: readonly WorkflowRunView[]
  readonly nextCursor?: string
  readonly phase: 'loading' | 'ready' | 'error'
  readonly error: string | null
  readonly loadingMore: boolean
}

export interface FactorySource {
  getSnapshot(): FactoryClientSnapshot
  subscribe(listener: () => void): () => void
}

export interface ILightcodeFactoryClient {
  readonly state: FactorySource
  refresh(): Promise<void>
  loadMore(): Promise<void>
  getRun(runId: string): Promise<WorkflowRunView>
  start(workflowId: string, input?: Readonly<Record<string, string>>, scheduledFor?: string): Promise<WorkflowRunView>
  cancel(runId: string): Promise<WorkflowRunView>
  review(runId: string, decision: 'complete' | 'cancel'): Promise<WorkflowRunView>
}

declare module '@deepseek-ai/cordis' {
  interface Context { lightcodeFactoryClient: ILightcodeFactoryClient }
}

type RemoteFactory = TypertClientRemote['factory']
const PAGE_SIZE = 60

export class LightcodeFactoryClient extends Service implements ILightcodeFactoryClient, FactorySource {
  readonly state: FactorySource = this
  private value: FactoryClientSnapshot = {
    definitions: [], runs: [], phase: 'loading', error: null, loadingMore: false,
  }
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, private readonly remote: RemoteFactory) {
    super(ctx, 'lightcodeFactoryClient')
  }

  getSnapshot(): FactoryClientSnapshot { return this.value }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async refresh(): Promise<void> {
    const [catalog, page] = await Promise.all([this.remote.catalog(), this.remote.listRuns({ limit: PAGE_SIZE })])
    if (!catalog.ok || !page.ok) {
      const error = !catalog.ok ? catalog.error.message : !page.ok ? page.error.message : 'Unknown Factory error'
      this.value = { ...this.value, phase: 'error', error, loadingMore: false }
    } else {
      this.value = {
        definitions: catalog.value,
        runs: page.value.runs,
        ...(page.value.nextCursor === undefined ? {} : { nextCursor: page.value.nextCursor }),
        phase: 'ready', error: null, loadingMore: false,
      }
    }
    this.notify()
  }

  async loadMore(): Promise<void> {
    if (this.value.nextCursor === undefined || this.value.loadingMore) return
    const cursor = this.value.nextCursor
    this.value = { ...this.value, loadingMore: true, error: null }
    this.notify()
    const page = await this.remote.listRuns({ limit: PAGE_SIZE, cursor })
    if (!page.ok) {
      this.value = { ...this.value, loadingMore: false, error: page.error.message }
    } else {
      const byId = new Map(this.value.runs.map(run => [run.id, run]))
      for (const run of page.value.runs) byId.set(run.id, run)
      const next = [...byId.values()].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      this.value = {
        ...this.value, runs: next, loadingMore: false, error: null,
        ...(page.value.nextCursor === undefined ? { nextCursor: undefined } : { nextCursor: page.value.nextCursor }),
      }
    }
    this.notify()
  }

  async getRun(runId: string): Promise<WorkflowRunView> {
    const result = await this.remote.getRun({ runId })
    if (!result.ok) throw new Error(result.error.message)
    this.upsert(result.value)
    return result.value
  }

  async start(workflowId: string, input?: Readonly<Record<string, string>>, scheduledFor?: string): Promise<WorkflowRunView> {
    return this.command(this.remote.start({ workflowId,
      ...(input === undefined ? {} : { input }), ...(scheduledFor === undefined ? {} : { scheduledFor }),
    }))
  }

  async cancel(runId: string): Promise<WorkflowRunView> {
    return this.command(this.remote.cancel({ runId }))
  }

  async review(runId: string, decision: 'complete' | 'cancel'): Promise<WorkflowRunView> {
    return this.command(this.remote.review({ runId, decision }))
  }

  private async command(resultPromise: ReturnType<RemoteFactory['start']>): Promise<WorkflowRunView> {
    const result = await resultPromise
    if (!result.ok) throw new Error(result.error.message)
    await this.refresh()
    this.upsert(result.value)
    return result.value
  }

  private upsert(run: WorkflowRunView): void {
    const runs = [run, ...this.value.runs.filter(value => value.id !== run.id)]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    this.value = { ...this.value, runs }
    this.notify()
  }

  private notify(): void { for (const listener of this.listeners) listener() }
}

export const name = 'lightcode-factory-runtime-client'
export const inject = ['remote']

export async function apply(ctx: Context): Promise<void> {
  await ctx.remote.$mount(factoryRemote)
  await ctx.inject(['remote.factory'], (bound) => {
    const service = new LightcodeFactoryClient(bound, bound.remote.factory)
    void service.refresh()
    const interval = setInterval(() => { void service.refresh() }, 750)
    bound.effect(() => () => { clearInterval(interval) }, 'lightcode-factory-client: polling')
  })
}

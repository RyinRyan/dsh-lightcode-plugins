import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { FactorySource } from 'lightcode-factory-runtime/client'
import type { WorkflowRunStatus, WorkflowRunView } from 'lightcode-factory-contracts/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FactoryLocaleKey } from './locales.ts'
import css from './FactoryWeb.module.css'
import { RunTrace } from './RunTrace.tsx'
import { RunOverview } from './RunOverview.tsx'

export interface FactoryWebInjected {
  readonly hooks: { readonly factorySnapshot: FactorySource }
  readonly refresh: () => Promise<void>
  readonly loadMore: () => Promise<void>
  readonly getRun: (runId: string) => Promise<WorkflowRunView>
  readonly start: (workflowId: string, input?: Readonly<Record<string, string>>, scheduledFor?: string) => Promise<WorkflowRunView>
  readonly cancel: (runId: string) => Promise<WorkflowRunView>
  readonly review: (runId: string, decision: 'complete' | 'cancel') => Promise<WorkflowRunView>
}
export type FactoryBoardProps = PropsRuntime<'main'> & PropsLocale<'factory'> & InjectFace<FactoryWebInjected>
const LANES: readonly WorkflowRunStatus[] = ['queued', 'running', 'review', 'completed', 'cancelled', 'failed']
type ExecutionMode = 'immediate' | 'scheduled'

function datetimeLocalValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function FactoryIcon({ size, active }: Pick<PropsRuntime<'sidebar.panellist'>, 'size' | 'active'>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={active ? css.iconActive : undefined} aria-hidden="true"><path d="M4 5h6v5H4V5Zm10 0h6v5h-6V5ZM4 14h6v5H4v-5Zm10 0h6v5h-6v-5Z" stroke="currentColor" strokeWidth="1.8" /><path d="M10 7.5h4M7 10v4m10-4v4" stroke="currentColor" strokeWidth="1.4" /></svg>
}

function isMultilineParameter(name: string, label: string): boolean {
  return /(备注|说明|描述|补充|上下文|notes?|description|comment|context|prompt)/i.test(`${name} ${label}`)
}

export function FactoryBoard({ useFactorySnapshot, refresh, loadMore, getRun, start, cancel, review, t }: FactoryBoardProps) {
  const snapshot = useFactorySnapshot(value => value)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [parameters, setParameters] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('immediate')
  const [scheduledLocal, setScheduledLocal] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const selected = snapshot.runs.find(run => run.id === selectedRunId)
  const grouped = useMemo(() => {
    const value: Record<WorkflowRunStatus, WorkflowRunView[]> = {
      queued: [], running: [], review: [], completed: [], cancelled: [], failed: [],
    }
    for (const run of snapshot.runs) value[run.status].push(run)
    return value
  }, [snapshot.runs])
  useEffect(() => {
    if (!creating) return
    dialogRef.current?.querySelector<HTMLElement>('select, input, textarea, button')?.focus()
  }, [creating])
  useEffect(() => {
    if (!creating) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        setCreating(false)
        setWorkflowId(null)
        setParameters({})
        setExecutionMode('immediate')
        setScheduledLocal('')
        setSubmitError(null)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [creating, submitting])
  if (selected !== undefined) return <RunDetail run={selected} t={t}
    back={() => { setSelectedRunId(null) }} cancel={() => { void cancel(selected.id) }}
    review={(decision) => { void review(selected.id, decision) }} />
  const selectedWorkflow = snapshot.definitions.find(definition => definition.id === workflowId) ?? snapshot.definitions[0]
  const compactParameterNames = selectedWorkflow?.parameters
    .filter((field, index) => index > 0 && !isMultilineParameter(field.name, field.label))
    .map(field => field.name) ?? []
  const unpairedCompactParameter = compactParameterNames.length % 2 === 1 ? compactParameterNames.at(-1) : undefined
  const closeCreator = () => {
    if (submitting) return
    setCreating(false)
    setWorkflowId(null)
    setParameters({})
    setExecutionMode('immediate')
    setScheduledLocal('')
    setSubmitError(null)
  }
  const submitTask = (mode: ExecutionMode, scheduledLocalValue: string) => {
    if (selectedWorkflow === undefined || submitting) return
    let scheduledFor: string | undefined
    if (mode === 'scheduled') {
      const timestamp = Date.parse(scheduledLocalValue)
      if (scheduledLocalValue === '' || Number.isNaN(timestamp) || timestamp <= Date.now()) {
        setSubmitError(t('task.scheduleFuture'))
        return
      }
      scheduledFor = new Date(timestamp).toISOString()
    }
    setSubmitting(true)
    setSubmitError(null)
    const admission = scheduledFor === undefined
      ? start(selectedWorkflow.id, parameters)
      : start(selectedWorkflow.id, parameters, scheduledFor)
    void admission.then(() => {
      setCreating(false)
      setWorkflowId(null)
      setParameters({})
      setExecutionMode('immediate')
      setScheduledLocal('')
    }).catch((error: unknown) => {
      setSubmitError(error instanceof Error ? error.message : String(error))
    }).finally(() => { setSubmitting(false) })
  }
  return <main className={css.root}>
    <header className={css.header}><div><h1>{t('panel.title')}</h1><p>{t('panel.subtitle')}</p></div><div className={css.actions}><button type="button" onClick={() => { setSubmitError(null); setCreating(true) }}>{t('task.create')}</button><button className={css.secondary} type="button" onClick={() => { void refresh() }}>{t('panel.refresh')}</button></div></header>
    {creating && <div className={css.taskModalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreator() }}>
      <div ref={dialogRef} className={css.taskModal} role="dialog" aria-modal="true" aria-labelledby="workflow-create-title">
        <header className={css.taskModalHeader}>
          <span className={css.taskModalIcon}><FactoryIcon size={24} active /></span>
          <div><h2 id="workflow-create-title">{t('task.create')}</h2><p>{t('task.dialogSubtitle')}</p></div>
          <button className={css.taskModalClose} type="button" aria-label={t('task.close')} disabled={submitting} onClick={closeCreator}>×</button>
        </header>
        <form onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const mode = data.get('execution-mode')
          submitTask(mode === 'scheduled' ? 'scheduled' : 'immediate', String(data.get('scheduled-for') ?? ''))
        }}>
          <div className={css.taskModalBody}>
            <section className={css.workflowChooser}>
              <h3>{t('task.select')}</h3>
              {selectedWorkflow === undefined ? <p className={css.notice}>{t('task.empty')}</p> : <>
                <div className={css.workflowSelectRow}>
                  <span aria-hidden="true">⌕</span>
                  <select aria-label={t('task.select')} value={selectedWorkflow.id} onChange={(event) => { setWorkflowId(event.target.value); setParameters({}); setSubmitError(null) }}>
                    {snapshot.definitions.map(definition => <option key={definition.id} value={definition.id}>{definition.name}</option>)}
                  </select>
                  <small>{selectedWorkflow.version}</small>
                </div>
                {selectedWorkflow.description !== '' && <p className={css.workflowDescription}>{selectedWorkflow.description}</p>}
                <p className={css.workflowHint}>{t('task.pluginHint')}</p>
              </>}
            </section>
            {selectedWorkflow !== undefined && <section className={css.taskConfiguration}>
              <h3>{t('task.configuration')}</h3>
              {selectedWorkflow.parameters.length === 0 ? <p className={css.notice}>{t('task.noParameters')}</p> : <div className={css.taskFields}>{selectedWorkflow.parameters.map((field, index) => {
                const multiline = isMultilineParameter(field.name, field.label)
                const value = parameters[field.name] ?? field.defaultValue ?? ''
                const controlProps = {
                  id: `workflow-parameter-${field.name}`,
                  'aria-label': field.label,
                  value,
                  required: field.required,
                  placeholder: t('task.fieldPlaceholder', { label: field.label }),
                  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setParameters({ ...parameters, [field.name]: event.target.value }) },
                }
                return <label className={css.taskField} data-wide={index === 0 || multiline || field.name === unpairedCompactParameter} key={field.name} htmlFor={controlProps.id}>
                  <span>{field.label}{field.required && <em aria-hidden="true">{t('task.required')}</em>}</span>
                  {multiline ? <textarea {...controlProps} rows={3} /> : <input {...controlProps} />}
                  {multiline && <small>{t('task.sensitiveHint')}</small>}
                </label>
              })}</div>}
            </section>}
            {selectedWorkflow !== undefined && <fieldset className={css.executionSchedule}>
              <legend>{t('task.executionMode')}</legend>
              <div className={css.executionChoices}>
                <label><input type="radio" name="execution-mode" value="immediate" checked={executionMode === 'immediate'} onChange={() => { setExecutionMode('immediate'); setScheduledLocal(''); setSubmitError(null) }} />{t('task.immediate')}</label>
                <label><input type="radio" name="execution-mode" value="scheduled" checked={executionMode === 'scheduled'} onChange={() => {
                  setExecutionMode('scheduled')
                  setScheduledLocal(value => value || datetimeLocalValue(new Date(Date.now() + 5 * 60_000)))
                  setSubmitError(null)
                }} />{t('task.scheduled')}</label>
              </div>
              {executionMode === 'scheduled' && <label className={css.scheduleTime} htmlFor="workflow-scheduled-for">
                <span>{t('task.scheduleTime')}</span>
                <input id="workflow-scheduled-for" name="scheduled-for" aria-label={t('task.scheduleTime')} type="datetime-local" required
                  min={datetimeLocalValue(new Date(Date.now() + 60_000))} value={scheduledLocal}
                  onChange={(event) => { setScheduledLocal(event.target.value); setSubmitError(null) }} />
                <small>{t('task.scheduleHint')}</small>
              </label>}
            </fieldset>}
            {submitError !== null && <p className={css.taskModalError} role="alert">{submitError}</p>}
          </div>
          <footer className={css.taskModalFooter}>
            <button className={css.secondary} type="button" disabled={submitting} onClick={closeCreator}>{t('task.cancel')}</button>
            <button type="submit" disabled={selectedWorkflow === undefined || submitting}>{submitting ? t('task.submitting') : t(executionMode === 'scheduled' ? 'task.submitScheduled' : 'task.submit')}</button>
          </footer>
        </form>
      </div>
    </div>}
    {snapshot.phase === 'loading' && <p className={css.notice}>{t('panel.loading')}</p>}
    {snapshot.error !== null && <p className={css.error}>{t('panel.error', { message: snapshot.error })}</p>}
    <section className={css.board}>{LANES.map(status => <section className={css.lane} key={status}><h2><i className={`${css.dot} ${css[status]}`} /><span>{t(statusTextKey(status))}</span><em>{grouped[status].length}</em></h2><div className={css.cards}>{grouped[status].map(run => <button className={css.card} key={run.id} type="button" aria-label={t('card.open', { name: run.name })} onClick={() => { setSelectedRunId(run.id); void getRun(run.id) }}><strong>{run.name}</strong><span>{run.status === 'queued' && run.scheduledFor !== undefined ? t('card.scheduled', { time: new Date(run.scheduledFor).toLocaleString() }) : run.currentNodeId === undefined ? t(statusTextKey(run.status)) : run.nodes.find(node => node.id === run.currentNodeId)?.name}</span><time>{t('card.created', { time: new Date(run.createdAt).toLocaleString() })}</time></button>)}{grouped[status].length === 0 && <span className={css.empty}>{t('board.empty')}</span>}</div></section>)}</section>
    {snapshot.nextCursor !== undefined && <footer className={css.actions}><button className={css.secondary} type="button" disabled={snapshot.loadingMore} onClick={() => { void loadMore() }}>{snapshot.loadingMore ? t('panel.loadingMore') : t('panel.loadMore')}</button></footer>}
  </main>
}

function RunDetail({ run, t, back, cancel, review }: { run: WorkflowRunView; t: FactoryBoardProps['t']; back: () => void; cancel: () => void; review: (decision: 'complete' | 'cancel') => void }) {
  const [sheet, setSheet] = useState<'overview' | 'trace'>('overview')
  return <main className={`${css.root} ${css.runDetailRoot}`}><header className={`${css.header} ${css.runHeader}`}><div><div className={css.breadcrumb}><button type="button" onClick={back}>{t('detail.board')}</button><span>/</span><strong>{run.name}</strong></div><div className={css.runTitle}><h1>{run.name}</h1><span data-status={run.status}>{t(statusTextKey(run.status))}</span></div><p>Run ID　·　{run.id}</p></div><div className={css.actions}>{['queued', 'running'].includes(run.status) && <button className={css.danger} type="button" onClick={cancel}>□　{t('action.cancel')}</button>}{run.status === 'review' && <><button className={css.danger} type="button" onClick={() => { review('cancel') }}>□　{t('action.reject')}</button><button className={css.approve} type="button" onClick={() => { review('complete') }}>●　{t('action.approve')}</button></>}</div></header>
    <nav className={css.detailSheets} aria-label={t('detail.sheets')}>
      <button type="button" aria-selected={sheet === 'overview'} onClick={() => { setSheet('overview') }}>{t('detail.overview')}</button>
      <button type="button" aria-selected={sheet === 'trace'} onClick={() => { setSheet('trace') }}>{t('detail.trace')}</button>
    </nav>
    {sheet === 'overview' ? <RunOverview run={run} t={t} /> : <RunTrace run={run} />}
  </main>
}

function statusTextKey(status: WorkflowRunStatus): FactoryLocaleKey { return `status.${status}` }

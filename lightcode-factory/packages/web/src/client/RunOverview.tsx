import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WorkflowNodeOutput, WorkflowNodeRun, WorkflowRunEvent, WorkflowRunView } from 'lightcode-factory-contracts/types'
import type { FactoryBoardProps } from './FactoryBoard.tsx'
import css from './FactoryWeb.module.css'

function serialize(value: WorkflowNodeOutput): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function isRecord(value: WorkflowNodeOutput): value is Readonly<Record<string, WorkflowNodeOutput>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textField(output: WorkflowNodeOutput | undefined, key: string): string | undefined {
  if (output === undefined || !isRecord(output)) return undefined
  const value = output[key]
  return typeof value === 'string' ? value : undefined
}

function numberField(output: WorkflowNodeOutput | undefined, key: string): number | null | undefined {
  if (output === undefined || !isRecord(output)) return undefined
  const value = output[key]
  return typeof value === 'number' || value === null ? value : undefined
}

function nodeStatusKey(status: WorkflowNodeRun['status']) {
  return `node.${status}` as const
}

function durationMs(node: WorkflowNodeRun): number | undefined {
  if (node.startedAt === undefined || node.finishedAt === undefined) return undefined
  return Math.max(0, Date.parse(node.finishedAt) - Date.parse(node.startedAt))
}

function formatDuration(duration: number): string {
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`
}

function formatTime(value: string | undefined): string {
  if (value === undefined) return '—'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function eventTone(event: WorkflowRunEvent): 'success' | 'warning' | 'primary' {
  if (/review|评审/i.test(event.type + event.message)) return 'warning'
  if (/complete|完成|success/i.test(event.type + event.message)) return 'success'
  return 'primary'
}

function NodeOutput({ node, t }: { node: WorkflowNodeRun; t: FactoryBoardProps['t'] }) {
  if (node.output === undefined) return <p className={css.outputEmpty}>{t('detail.none')}</p>
  const text = textField(node.output, 'text')
  const quote = textField(node.output, 'quote')
  const author = textField(node.output, 'author')
  const code = textField(node.output, 'code')
  const filename = textField(node.output, 'filename')

  if (text !== undefined && quote !== undefined) return <div className={css.greeting}>
    <p>{text}</p><blockquote>{quote}{author !== undefined && <cite>—— {author}</cite>}</blockquote>
  </div>
  if (code !== undefined) return <div className={css.scriptOutput}>
    {filename !== undefined && <p className={css.artifactLine}>▣ {filename}</p>}
    <pre>{code}</pre>
  </div>
  return <pre>{serialize(node.output)}</pre>
}

function OutputWorkbench({ run, node, t }: { run: WorkflowRunView; node: WorkflowNodeRun; t: FactoryBoardProps['t'] }) {
  const stdout = textField(node.output, 'stdout')
  const stderr = textField(node.output, 'stderr')
  const hasRuntimeOutput = stdout !== undefined || stderr !== undefined
  const sourceNode = hasRuntimeOutput
    ? [...run.nodes].reverse().find(candidate => textField(candidate.output, 'code') !== undefined)
    : node
  const code = textField(sourceNode?.output, 'code')
  const filename = textField(sourceNode?.output, 'filename') ?? 'generated-demo.mjs'
  const artifactPath = textField(node.output, 'artifactPath')
  const exitCode = numberField(node.output, 'exitCode')
  const outputLines = (stdout ?? '').trim() === '' ? 0 : (stdout ?? '').trimEnd().split(/\r?\n/).length
  const duration = durationMs(node)
  const runtimeText = `$ node ${artifactPath?.split(/[\\/]/).at(-1) ?? filename}${stdout === undefined || stdout === '' ? '' : `\n${stdout}`}${stderr === undefined || stderr === '' ? '' : `\n${stderr}`}`

  return <article className={css.fidelityOutput} aria-label={t('detail.output')}>
    <header className={css.outputTitlebar}>
      <span className={css.outputTitleIcon}>●</span>
      <div><h2>{node.name}</h2><p>{t(nodeStatusKey(node.status))}</p></div>
      <span className={css.outputSuccess}>{node.status === 'completed' ? '✓' : '●'} {t(nodeStatusKey(node.status))}</span>
      <time>{formatTime(node.finishedAt ?? node.startedAt)}</time>
      <button type="button" aria-label="更多操作">⋮</button>
    </header>
    <div className={`${css.ideWorkspace} ${code === undefined || !hasRuntimeOutput ? css.singlePane : ''}`}>
      {code !== undefined && <section className={css.idePane}>
        <header><span className={css.fileIcon}>▱</span><strong>{filename}</strong></header>
        <pre className={css.codePreview}>{code}</pre>
      </section>}
      {hasRuntimeOutput && <section className={css.idePane}>
        <header><span className={css.terminalIcon}>›_</span><strong>{t('detail.stdout')}</strong><button type="button" aria-label="复制运行输出" onClick={() => { void navigator.clipboard?.writeText(runtimeText) }}>▢ {t('detail.copy')}</button></header>
        <pre className={css.runtimeOutput}><span>$ node {artifactPath?.split(/[\\/]/).at(-1) ?? filename}</span>{stdout === undefined || stdout === '' ? '' : `\n${stdout}`}{stderr === undefined || stderr === '' ? '' : `\n${stderr}`}</pre>
        <dl className={css.resultStats}>
          <div><dt>{t('detail.exitCode')}</dt><dd>{exitCode ?? '—'}</dd></div>
          <div><dt>{t('detail.durationLabel')}</dt><dd>{duration === undefined ? '—' : formatDuration(duration)}</dd></div>
          <div><dt>{t('detail.outputLines')}</dt><dd>{outputLines} {t('detail.lines')}</dd></div>
        </dl>
      </section>}
      {code === undefined && !hasRuntimeOutput && <section className={`${css.idePane} ${css.genericOutput}`}>
        <header><span className={css.fileIcon}>◇</span><strong>{t('detail.output')}</strong></header>
        <div><NodeOutput node={node} t={t} />{node.error !== undefined && <pre className={css.nodeError}>{node.error}</pre>}</div>
      </section>}
    </div>
  </article>
}

export function RunOverview({ run, t }: { run: WorkflowRunView; t: FactoryBoardProps['t'] }) {
  const completedCount = run.nodes.filter(node => ['completed', 'cancelled', 'failed'].includes(node.status)).length
  const progress = run.nodes.length === 0 ? 0 : Math.round(completedCount / run.nodes.length * 100)
  const defaultNodeId = run.currentNodeId ?? [...run.nodes].reverse().find(node => node.output !== undefined || node.error !== undefined)?.id ?? run.nodes[0]?.id
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(defaultNodeId)
  const [eventsOpen, setEventsOpen] = useState(true)
  const [eventsFirst, setEventsFirst] = useState(false)
  const nodesTrack = useRef<HTMLDivElement>(null)
  const drag = useRef({ active: false, moved: false, startX: 0, scrollLeft: 0 })
  const suppressClick = useRef(false)
  const [nodesScrollable, setNodesScrollable] = useState(false)
  const nodesLayoutKey = run.nodes.map(node => `${node.id}\u0000${node.name}`).join('\u0001')

  useEffect(() => {
    if (selectedNodeId !== undefined && !run.nodes.some(node => node.id === selectedNodeId)) setSelectedNodeId(defaultNodeId)
  }, [defaultNodeId, run.nodes, selectedNodeId])

  useLayoutEffect(() => {
    const track = nodesTrack.current
    if (track === null) return
    const measure = () => {
      const hint = track.querySelector<HTMLElement>('[data-overflow-hint]')
      const hintStyle = hint === null ? undefined : window.getComputedStyle(hint)
      const hintWidth = hint === null ? 0 : hint.offsetWidth + Number.parseFloat(hintStyle?.marginLeft ?? '0') + Number.parseFloat(hintStyle?.marginRight ?? '0')
      const nextScrollable = track.scrollWidth - hintWidth > track.clientWidth + 1
      setNodesScrollable(current => current === nextScrollable ? current : nextScrollable)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => { observer.disconnect() }
  }, [nodesLayoutKey, run.id])

  const selectedNode = run.nodes.find(node => node.id === selectedNodeId) ?? run.nodes[0]
  const currentNode = run.nodes.find(node => node.id === run.currentNodeId)
  const startedAt = run.events.find(event => event.type === 'run.started')?.at
    ?? run.nodes.find(node => node.startedAt !== undefined)?.startedAt
  const terminal = ['review', 'completed', 'cancelled', 'failed'].includes(run.status)
  const elapsed = startedAt === undefined ? undefined : Math.max(0, Date.parse(run.updatedAt) - Date.parse(startedAt))

  const eventTimeline = <section className={css.fidelityEvents} data-open={eventsOpen}>
    <header>
      <button className={css.eventsToggle} type="button" aria-expanded={eventsOpen} onClick={() => { setEventsOpen(value => !value) }}>
        <span className={css.clockIcon}>◷</span><strong>{t('detail.events')} · {run.events.length}</strong>
      </button>
      <div className={css.eventControls}>
        <button type="button" aria-label={t('detail.moveUp')} disabled={eventsFirst} onClick={() => { setEventsFirst(true) }}>↑</button>
        <button type="button" aria-label={t('detail.moveDown')} disabled={!eventsFirst} onClick={() => { setEventsFirst(false) }}>↓</button>
        <button type="button" onClick={() => { setEventsOpen(value => !value) }}>{eventsOpen ? `⌃ ${t('detail.collapse')}` : `⌄ ${t('detail.expand')}`}</button>
      </div>
    </header>
    {eventsOpen && <div className={css.fidelityEventList}>{run.events.length === 0 && <p className={css.outputEmpty}>{t('detail.noEvents')}</p>}{run.events.map(event => <div key={event.sequence} data-tone={eventTone(event)}><span className={css.eventCheck}>{eventTone(event) === 'success' ? '✓' : '●'}</span><time>{formatTime(event.at)}</time><i /><strong>{event.message}</strong></div>)}</div>}
  </section>

  return <section className={css.fidelityOverview} aria-label={t('detail.overview')}>
    <section className={css.runSummary}>
      <div className={css.progressSummary}>
        <span>{t('detail.progress')}</span><strong>{progress}%</strong>
        <progress max="100" value={progress}>{progress}%</progress>
        <small>{completedCount} / {run.nodes.length} {t('detail.nodesComplete')}</small>
      </div>
      <div className={css.summaryDivider} />
      <div ref={nodesTrack} className={css.fidelityNodeTrack} data-scrollable={nodesScrollable}
        onPointerDown={(event) => {
          if (!nodesScrollable || nodesTrack.current === null || event.button !== 0) return
          drag.current = { active: true, moved: false, startX: event.clientX, scrollLeft: nodesTrack.current.scrollLeft }
          nodesTrack.current.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current.active || nodesTrack.current === null) return
          const distance = event.clientX - drag.current.startX
          drag.current.moved ||= Math.abs(distance) > 10
          if (!drag.current.moved) return
          nodesTrack.current.scrollLeft = drag.current.scrollLeft - distance
        }}
        onPointerUp={(event) => {
          suppressClick.current = drag.current.moved
          drag.current.active = false
          nodesTrack.current?.releasePointerCapture(event.pointerId)
          window.setTimeout(() => { suppressClick.current = false }, 0)
        }}
        onPointerCancel={() => { drag.current.active = false }}>
        {run.nodes.map((node, index) => <div className={css.nodeStep} key={node.id}>
          <button type="button" data-status={node.status} aria-pressed={node.id === selectedNode?.id}
            onClick={() => { if (!suppressClick.current) setSelectedNodeId(node.id) }}>
            <span>{node.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <div><strong>{node.name}</strong><small>{t(nodeStatusKey(node.status))} · {formatTime(node.finishedAt ?? node.startedAt)}</small></div>
          </button>
          {index < run.nodes.length - 1 && <i className={css.nodeConnector} />}
        </div>)}
        {nodesScrollable && <div className={css.dragMore} data-overflow-hint><span>›</span><small>{t('detail.dragMore')}</small></div>}
      </div>
    </section>

    {eventsFirst && eventTimeline}
    <div className={css.fidelityDetailGrid}>
      {selectedNode !== undefined && <OutputWorkbench run={run} node={selectedNode} t={t} />}
      <aside className={css.fidelityRunSidebar}>
        <section className={css.fidelityRunInfo}><h2><span>ⓘ</span>{t('detail.runInfo')}</h2><dl>
           <div><dt>{t('detail.status')}</dt><dd><i className={`${css.dot} ${css[run.status]}`} />{t(`status.${run.status}`)}</dd></div>
           <div><dt>{t('detail.currentNode')}</dt><dd>{currentNode?.name ?? (terminal ? t('detail.allNodesComplete') : '—')}</dd></div>
          {run.scheduledFor !== undefined && <div><dt>{t('detail.scheduledFor')}</dt><dd>{new Date(run.scheduledFor).toLocaleString()}</dd></div>}
          {startedAt !== undefined && <div><dt>{t('detail.startedAt')}</dt><dd>{new Date(startedAt).toLocaleString()}</dd></div>}
          {terminal && <div><dt>{t('detail.finishedAt')}</dt><dd>{new Date(run.updatedAt).toLocaleString()}</dd></div>}
          {elapsed !== undefined && <div><dt>{t('detail.elapsed')}</dt><dd>{formatDuration(elapsed)}</dd></div>}
          <div><dt>{t('detail.workflow')}</dt><dd>{run.workflowId}{run.workflowVersion === undefined ? '' : ` @ ${run.workflowVersion}`}</dd></div>
        </dl></section>
        {run.status === 'review' && <section className={css.reviewNotice}><span>!</span><div><strong>{t('detail.manualReview')}</strong><p>{t('detail.reviewHint')}</p></div></section>}
      </aside>
    </div>
    {!eventsFirst && eventTimeline}
  </section>
}

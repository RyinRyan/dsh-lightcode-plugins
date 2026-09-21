import { useMemo, useState, type CSSProperties } from 'react'
import type { WorkflowNodeOutput, WorkflowRunView } from 'lightcode-factory-contracts/types'
import css from './FactoryWeb.module.css'

type TraceKind = 'input' | 'model' | 'tool' | 'context'

interface TraceRecord {
  readonly id: string
  readonly nodeId: string
  readonly nodeIndex: number
  readonly at: string
  readonly kind: TraceKind
  readonly tag: string
  readonly title: string
  readonly detail: string
  readonly callId?: string
}

function serialize(value: WorkflowNodeOutput): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function recordKind(kind: string): TraceKind {
  if (kind === 'llm.request') return 'input'
  if (kind.includes('tool') || kind.startsWith('process.')) return 'tool'
  if (kind.startsWith('llm.') || kind.startsWith('assistant/') || kind.startsWith('step/') || kind.startsWith('turn/')) return 'model'
  return 'context'
}

function recordTag(kind: TraceKind, source: string): string {
  if (source === 'llm.reasoning') return '推理'
  if (source === 'llm.response') return '助手'
  if (source === 'llm.request') return '输入'
  if (source === 'llm.tool-call') return '工具调用'
  if (source === 'llm.tool-result') return '工具结果'
  if (source === 'process.start') return '进程'
  if (source === 'process.result') return '进程结果'
  return kind === 'model' ? '模型' : kind === 'tool' ? '工具' : '上下文'
}

function prettyDetail(detail: string): string {
  try { return JSON.stringify(JSON.parse(detail), null, 2) } catch { return detail }
}

function oneLine(detail: string): string {
  const text = prettyDetail(detail).replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 177)}…` : text
}

function traceRecords(run: WorkflowRunView): readonly TraceRecord[] {
  const records: TraceRecord[] = []
  run.nodes.forEach((node, nodeIndex) => {
    node.observations.forEach((observation, index) => {
      const kind = recordKind(observation.kind)
      records.push({
        id: `${node.id}:observation:${index}`,
        nodeId: node.id,
        nodeIndex,
        at: observation.at,
        kind,
        tag: recordTag(kind, observation.kind),
        title: observation.title,
        detail: prettyDetail(observation.detail),
        ...(observation.callId === undefined ? {} : { callId: observation.callId }),
      })
    })
    if (node.output !== undefined) records.push({
      id: `${node.id}:output`, nodeId: node.id, nodeIndex,
      at: node.finishedAt ?? node.startedAt ?? run.updatedAt,
      kind: 'context', tag: '输出', title: `${node.name} · 节点输出`, detail: serialize(node.output),
    })
    if (node.error !== undefined) records.push({
      id: `${node.id}:error`, nodeId: node.id, nodeIndex,
      at: node.finishedAt ?? run.updatedAt,
      kind: 'context', tag: '错误', title: `${node.name} · 执行失败`, detail: node.error,
    })
  })
  return records.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
}

function elapsed(records: readonly TraceRecord[], index: number): string {
  const start = Date.parse(records[index]?.at ?? '')
  const end = Date.parse(records[index + 1]?.at ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  const duration = Math.max(0, end - start)
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`
}

function timelineLeft(record: TraceRecord, index: number, records: readonly TraceRecord[]): number {
  const first = Date.parse(records[0]?.at ?? '')
  const last = Date.parse(records.at(-1)?.at ?? '')
  const current = Date.parse(record.at)
  if (Number.isFinite(first) && Number.isFinite(last) && Number.isFinite(current) && last > first) {
    return Math.min(98, Math.max(0, (current - first) / (last - first) * 100))
  }
  return records.length <= 1 ? 0 : index / (records.length - 1) * 98
}

const lane: Record<TraceKind, number> = { input: 0, model: 1, tool: 2, context: 1 }
const nodeStatus = { pending: '待执行', running: '执行中', completed: '已完成', cancelled: '已取消', failed: '失败' } as const

export function RunTrace({ run }: { run: WorkflowRunView }) {
  const allRecords = useMemo(() => traceRecords(run), [run])
  const [nodeId, setNodeId] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [showDuration, setShowDuration] = useState(true)
  const [showGroups, setShowGroups] = useState(true)
  const [showCallIds, setShowCallIds] = useState(false)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return allRecords.filter(record => (nodeId === 'all' || record.nodeId === nodeId)
      && (needle === '' || `${record.tag} ${record.title} ${record.detail} ${record.callId ?? ''}`.toLocaleLowerCase().includes(needle)))
  }, [allRecords, nodeId, query])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = filtered.find(record => record.id === selectedId) ?? filtered[0]
  let lastNode = ''

  return <section className={css.traceSurface} aria-label="运行轨迹">
    <nav className={css.nodeFilter} aria-label="轨迹节点范围">
      <button type="button" aria-pressed={nodeId === 'all'} onClick={() => { setNodeId('all'); setSelectedId(null) }}>全部节点</button>
      {run.nodes.map((node, index) => <button key={node.id} type="button" aria-pressed={nodeId === node.id} onClick={() => { setNodeId(node.id); setSelectedId(null) }}>
        <b>{index + 1}</b>{node.name}<small>{nodeStatus[node.status]}</small>
      </button>)}
    </nav>
    <div className={css.traceToolbar} role="toolbar" aria-label="轨迹工具栏">
      <div>
        <button type="button" aria-pressed={showDuration} onClick={() => { setShowDuration(value => !value) }}>◷ 时长</button>
        <button type="button" aria-pressed={showGroups} onClick={() => { setShowGroups(value => !value) }}>▤ 节点</button>
        <button type="button" aria-pressed={showCallIds} onClick={() => { setShowCallIds(value => !value) }}>▣ 调用</button>
      </div>
      <label><span aria-hidden="true">⌕</span><input value={query} onChange={event => { setQuery(event.target.value); setSelectedId(null) }} placeholder="搜索轨迹" aria-label="搜索轨迹" /></label>
    </div>
    <div className={css.traceTimeline} role="region" aria-label="轨迹时间线">
      <div className={css.timelineLabels}><span>输入</span><span>模型</span><span>工具</span></div>
      <div className={css.timelineTrack}>{filtered.map((record, index) => <button
        key={record.id} type="button" aria-label={`${record.tag} ${record.title}`}
        className={`${css.timelineMark} ${css[`trace${record.kind}`]}`}
        data-selected={selected?.id === record.id}
        style={{ left: `${timelineLeft(record, index, filtered)}%`, top: `${7 + lane[record.kind] * 14}px` } as CSSProperties}
        onClick={() => { setSelectedId(record.id) }} />)}</div>
    </div>
    <div className={css.traceBody}>
      <div className={css.traceLedger}>
        {filtered.length === 0 && <p className={css.traceEmpty}>没有匹配的轨迹记录</p>}
        {filtered.map((record, index) => {
          const node = run.nodes[record.nodeIndex]
          const startsNode = record.nodeId !== lastNode
          lastNode = record.nodeId
          return <div key={record.id}>
            {showGroups && startsNode && <div className={css.traceGroup}><span>节点 {record.nodeIndex + 1}</span><strong>{node?.name}</strong></div>}
            <button type="button" className={css.traceRow} data-kind={record.kind} data-selected={selected?.id === record.id} onClick={() => { setSelectedId(record.id) }}>
              <span className={css.traceIndex}>{index + 1}</span>
              <span className={css.traceTag}>{record.tag}</span>
              <span className={css.traceText}><strong>{record.title}</strong><small>{oneLine(record.detail)}</small></span>
              {showCallIds && <code className={css.traceCall}>{record.callId ?? '—'}</code>}
              {showDuration && <time className={css.traceDuration}>{elapsed(filtered, index)}</time>}
            </button>
          </div>
        })}
      </div>
      <aside className={css.traceInspector} aria-label="轨迹记录详情">
        {selected === undefined ? <p>选择一条轨迹记录查看详情</p> : <>
          <header><span className={css.traceTag} data-kind={selected.kind}>{selected.tag}</span><strong>{selected.title}</strong></header>
          <dl><div><dt>节点</dt><dd>{run.nodes[selected.nodeIndex]?.name}</dd></div><div><dt>时间</dt><dd>{new Date(selected.at).toLocaleString()}</dd></div>{selected.callId !== undefined && <div><dt>调用 ID</dt><dd>{selected.callId}</dd></div>}</dl>
          <pre>{selected.detail}</pre>
        </>}
      </aside>
    </div>
  </section>
}

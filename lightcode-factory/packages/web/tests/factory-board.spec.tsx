// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { FactoryClientSnapshot } from 'lightcode-factory-runtime/client'
import { FactoryBoard, type FactoryBoardProps } from '../src/client/FactoryBoard.tsx'
import { zh, type FactoryLocaleKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function props(snapshot: Omit<FactoryClientSnapshot, 'loadingMore'> & Partial<Pick<FactoryClientSnapshot, 'loadingMore'>>, start = vi.fn().mockResolvedValue({})) {
  const value: FactoryClientSnapshot = { loadingMore: false, ...snapshot }
  return {
    useFactorySnapshot: (select: (value: FactoryClientSnapshot) => unknown) => select(value),
    start, cancel: vi.fn(), review: vi.fn(), refresh: vi.fn(), loadMore: vi.fn(), getRun: vi.fn(),
    t: (key: FactoryLocaleKey, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce((text, [key, value]) => text.replace('{' + key + '}', value), zh[key]),
  } as unknown as FactoryBoardProps
}

it('creates a plugin-contributed task with its own input fields', async () => {
  const start = vi.fn().mockResolvedValue({})
  render(<FactoryBoard {...props({ phase: 'ready', error: null, runs: [], definitions: [{
    id: 'report', version: '1.0.0', name: '报告生成', description: '',
    parameters: [{ name: 'subject', label: '报告主题', required: true }], nodes: [{ id: 'report', name: '生成报告' }],
  }] }, start)} />)
  fireEvent.click(screen.getByText('新建任务'))
  expect(screen.getByRole('dialog', { name: '新建任务' })).toBeTruthy()
  expect(screen.getByText('参数由所选工作流插件提供')).toBeTruthy()
  expect(screen.getByText('待调度')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('报告主题'), { target: { value: '项目分析' } })
  fireEvent.click(screen.getByText('创建并执行'))
  await waitFor(() =>{  expect(start).toHaveBeenCalledWith('report', { subject: '项目分析' }) })
  await waitFor(() =>{  expect(screen.queryByText('创建并执行')).toBeNull() })
})

it('keeps the board in place and dismisses the task dialog without creating a run', () => {
  const start = vi.fn().mockResolvedValue({})
  render(<FactoryBoard {...props({ phase: 'ready', error: null, runs: [], definitions: [{
    id: 'release-review', version: '1.0.0', name: '发布就绪评估', description: '评估项目发布准备度并生成风险结论',
    parameters: [
      { name: 'projectName', label: '项目名称', required: true },
      { name: 'targetVersion', label: '目标版本', required: true },
      { name: 'riskNotes', label: '补充风险备注', required: false },
    ], nodes: [{ id: 'review', name: '执行评估' }],
  }] }, start)} />)

  fireEvent.click(screen.getByText('新建任务'))
  expect(screen.getByRole('dialog', { name: '新建任务' })).toBeTruthy()
  expect(screen.getByText('发布就绪评估')).toBeTruthy()
  expect(screen.getByText('1.0.0')).toBeTruthy()
  expect(screen.getByText('评估项目发布准备度并生成风险结论')).toBeTruthy()
  expect(screen.getByLabelText('补充风险备注').tagName).toBe('TEXTAREA')
  expect(screen.getAllByText('暂无工作流')).toHaveLength(6)

  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(start).not.toHaveBeenCalled()
})

it('creates a one-time scheduled task from local browser time', async () => {
  const start = vi.fn().mockResolvedValue({})
  render(<FactoryBoard {...props({ phase: 'ready', error: null, runs: [], definitions: [{
    id: 'report', version: '1.0.0', name: '报告生成', description: '',
    parameters: [{ name: 'subject', label: '报告主题', required: true }], nodes: [{ id: 'report', name: '生成报告' }],
  }] }, start)} />)

  fireEvent.click(screen.getByText('新建任务'))
  fireEvent.change(screen.getByLabelText('报告主题'), { target: { value: '定时报告' } })
  fireEvent.click(screen.getByLabelText('定时执行'))
  const localTime = '2099-01-02T03:04'
  fireEvent.change(screen.getByLabelText('计划执行时间'), { target: { value: localTime } })
  fireEvent.click(screen.getByText('创建定时任务'))

  await waitFor(() => {
    expect(start).toHaveBeenCalledWith('report', { subject: '定时报告' }, new Date(localTime).toISOString())
  })
})

it('rejects a scheduled submission with no time instead of creating an immediate task', async () => {
  const start = vi.fn().mockResolvedValue({})
  render(<FactoryBoard {...props({ phase: 'ready', error: null, runs: [], definitions: [{
    id: 'report', version: '1.0.0', name: '报告生成', description: '',
    parameters: [{ name: 'subject', label: '报告主题', required: true }], nodes: [{ id: 'report', name: '生成报告' }],
  }] }, start)} />)

  fireEvent.click(screen.getByText('新建任务'))
  fireEvent.change(screen.getByLabelText('报告主题'), { target: { value: '定时报告' } })
  fireEvent.click(screen.getByLabelText('定时执行'))
  fireEvent.change(screen.getByLabelText('计划执行时间'), { target: { value: '' } })
  fireEvent.submit(screen.getByRole('button', { name: '创建定时任务' }).closest('form')!)

  expect(start).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe('请选择未来的执行时间')
})

it('shows the planned time for a queued scheduled task', () => {
  render(<FactoryBoard {...props({ phase: 'ready', error: null, definitions: [], runs: [{
    id: 'scheduled', workflowId: 'report', workflowVersion: '1.0.0', input: {}, name: '报告生成', status: 'queued',
    createdAt: '2026-09-18T01:00:00.000Z', updatedAt: '2026-09-18T01:00:00.000Z',
    scheduledFor: '2099-01-02T03:04:00.000Z', events: [], nodes: [],
  }] })} />)

  expect(screen.getByText(/计划于/)).toBeTruthy()
})

it('keeps run details as the default sheet and opens trajectory on demand', () => {
  render(<FactoryBoard {...props({ phase: 'ready', error: null, definitions: [], runs: [{
    id: 'one', workflowId: 'report', name: '报告生成', status: 'review', createdAt: '2026-09-16', updatedAt: '2026-09-16',
    events: [{ sequence: 1, at: '2026-09-16', type: 'node.completed', message: '报告节点已完成' }], nodes: [{ id: 'report', name: '生成报告', status: 'completed',
      output: { verdict: '检查通过', score: 98 },
      observations: [{ at: '2026-09-16', kind: 'llm.tool-result', title: '读取结果', detail: '实际工具输出', callId: 'c1' }],
    }],
  }] })} />)
  fireEvent.click(screen.getByText('报告生成'))
  expect(screen.getByLabelText('工作流详情页签')).toBeTruthy()
  expect(screen.getByLabelText('运行详情').textContent).toContain('检查通过')
  expect(screen.getByLabelText('运行详情').textContent).not.toContain('实际工具输出')
  expect(screen.getByText('运行信息')).toBeTruthy()
  expect(screen.getByText('整体进度')).toBeTruthy()
  const events = screen.getByRole('button', { name: /事件时间线/ })
  expect(events.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('报告节点已完成')).toBeTruthy()
  fireEvent.click(events)
  expect(events.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('报告节点已完成')).toBeNull()
  expect(screen.queryByRole('toolbar', { name: '轨迹工具栏' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '轨迹' }))
  expect(screen.getByRole('toolbar', { name: '轨迹工具栏' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '轨迹时间线' })).toBeTruthy()
  expect(screen.getByLabelText('轨迹记录详情').textContent).toContain('实际工具输出')
  fireEvent.click(screen.getByText('生成报告 · 节点输出'))
  expect(screen.getByLabelText('轨迹记录详情').textContent).toContain('检查通过')
  expect(screen.getByLabelText('轨迹记录详情').textContent).toContain('98')
})

it('switches final output with the selected node and avoids pointless scrolling for three nodes', () => {
  render(<FactoryBoard {...props({ phase: 'ready', error: null, definitions: [], runs: [{
    id: 'morning', workflowId: 'morning-script-demo', name: '晨间脚本生成', status: 'review',
    createdAt: '2026-09-17T09:52:10+08:00', updatedAt: '2026-09-17T09:52:11+08:00',
    events: [], nodes: [
      { id: 'greeting', name: '早安、时间与名言', status: 'completed', observations: [],
        output: { text: '早上好，当前时间 09:52:10', quote: '生活就像骑自行车。', author: '爱因斯坦' } },
      { id: 'generate', name: '生成独立脚本', status: 'completed', observations: [],
        output: { filename: 'generated-demo.mjs', code: 'console.log(28)' } },
      { id: 'execute', name: '执行脚本并收集输出', status: 'completed', observations: [],
        output: { stdout: '28\n', stderr: '', exitCode: 0, artifactPath: 'generated-demo.mjs' } },
    ],
  }] })} />)
  fireEvent.click(screen.getByText('晨间脚本生成'))
  expect(screen.getByLabelText('节点输出').textContent).toContain('$ node generated-demo.mjs')
  fireEvent.click(screen.getByRole('button', { name: /早安、时间与名言/ }))
  expect(screen.getByLabelText('节点输出').textContent).toContain('早上好，当前时间 09:52:10')
  expect(screen.getByLabelText('节点输出').textContent).not.toContain('$ node generated-demo.mjs')
  expect(screen.queryByText('向右滑动查看更多节点')).toBeNull()
})

it('enables horizontal node navigation only when the track actually overflows', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)

  render(<FactoryBoard {...props({ phase: 'ready', error: null, definitions: [], runs: [{
    id: 'long-flow', workflowId: 'long-flow', name: '多节点工作流', status: 'running',
    createdAt: '2026-09-17T09:52:10+08:00', updatedAt: '2026-09-17T09:52:11+08:00',
    events: [], nodes: Array.from({ length: 6 }, (_, index) => ({
      id: `node-${index + 1}`,
      name: `处理节点 ${index + 1}`,
      status: index < 2 ? 'completed' as const : index === 2 ? 'running' as const : 'pending' as const,
      observations: [],
      output: index < 2 ? { text: `节点 ${index + 1} 输出` } : undefined,
    })),
  }] })} />)
  fireEvent.click(screen.getByText('多节点工作流'))

  expect(await screen.findByText('向右滑动查看更多节点')).toBeTruthy()
})

it('loads another bounded page only when a continuation cursor exists', () => {
  const loadMore = vi.fn().mockResolvedValue(undefined)
  render(<FactoryBoard {...props({
    phase: 'ready', error: null, definitions: [], runs: [], nextCursor: 'next-page',
  })} loadMore={loadMore} />)
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
  expect(loadMore).toHaveBeenCalledTimes(1)

  cleanup()
  render(<FactoryBoard {...props({ phase: 'ready', error: null, definitions: [], runs: [] })} loadMore={loadMore} />)
  expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
})

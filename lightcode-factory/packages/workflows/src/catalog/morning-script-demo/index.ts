/** Complete Demo workflow: business steps, native Agent execution and managed script process. */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { WorkflowNodeContext, WorkflowRegistration } from 'lightcode-factory-contracts/workflow'

/** Business execution limits owned by this workflow, not by the Runtime. */
export interface MorningScriptDemoConfig {
  /** Parent directory containing one artifact directory per task. */
  artifactRoot: string
  /** Maximum bytes retained from the generated process output. */
  outputLimitBytes?: number
  /** Maximum accumulated model stream characters before aborting. */
  modelOutputLimitChars?: number
  /** Independent timeout for model generation and script execution. */
  timeoutMs?: number
}
export const morningScriptDemoConfig: z<MorningScriptDemoConfig> = z.object({
  artifactRoot: z.string().required(),
  outputLimitBytes: z.natural().min(1024).max(4194304).default(131072),
  modelOutputLimitChars: z.natural().min(1024).max(4194304).default(262144),
  timeoutMs: z.natural().min(1000).max(2147483647).default(300000),
})

const greetingNode = { id: 'morning-greeting', name: '早安、时间与名言' }
const generateNode = { id: 'generate-script', name: '使用当前模型生成独立脚本' }
const executeNode = { id: 'execute-script', name: '执行脚本并收集输出' }

/** Register the workflow for this plugin's lifetime.
 * @param ctx - injected DSH capabilities.
 * @param config - validated workflow configuration.
 */
export function createMorningScriptDemoWorkflow(ctx: Context, config: MorningScriptDemoConfig): WorkflowRegistration {
  const resolved = config as Required<MorningScriptDemoConfig>
  const workflow: WorkflowRegistration = {
    id: 'morning-script-demo', name: '晨间脚本生成', version: '1.0.0',
    description: '发送问候，使用当前 DSH 模型生成脚本，再执行并收集结果。',
    parameters: [{
      name: 'instruction', label: '脚本要求', required: true,
      defaultValue: '打印数组 [2, 3, 5, 7, 11]，计算并打印总和。',
    }],
    nodes: [greetingNode, generateNode, executeNode],
    async execute(context) {
      await context.node(greetingNode, async (node) => {
        const currentTime = new Intl.DateTimeFormat('zh-CN', {
          dateStyle: 'full', timeStyle: 'medium', timeZone: 'Asia/Shanghai',
        }).format(new Date())
        await node.log('读取当前时间')
        return { text: '早上好，当前时间 ' + currentTime, currentTime,
          quote: '生活就像骑自行车。要保持平衡，就必须不断前进。', author: '阿尔伯特·爱因斯坦' }
      })
      const runRoot = resolve(resolved.artifactRoot, context.runId)
      await mkdir(runRoot, { recursive: true })
      const script = await context.node(generateNode, node =>
        generateScript(ctx, resolved, runRoot, context.input.instruction ?? '', node))
      await context.node(executeNode, node => executeScript(ctx, resolved, runRoot, script.code, node))
    },
  }
  return workflow
}

async function generateScript(
  ctx: Context, config: Required<MorningScriptDemoConfig>, cwd: string, instruction: string, node: WorkflowNodeContext,
): Promise<{ filename: string; code: string; sessionId: string }> {
  const selection = ctx.agentDefaultModel.currentSelection()
  const sessionId = SessionId(randomUUID())
  const controller = new AbortController()
  const relay = () =>{  controller.abort(node.signal.reason) }
  node.signal.addEventListener('abort', relay, { once: true })
  if (node.signal.aborted) relay()
  const timeout = setTimeout(() =>{  controller.abort(new Error('Model generation timed out')) }, config.timeoutMs)
  let reports = Promise.resolve()
  let reportFailure: Error | undefined
  let stopReason: string | undefined
  let answer = ''
  let chars = 0
  let buffer = ''
  let bufferKind = 'llm.response'
  const enqueue = (kind: string, title: string, detail: string, callId?: string) => {
    reports = reports.then(() => node.report({
      kind, title, detail, sessionId, ...(callId === undefined ? {} : { callId }),
    })).catch((error: unknown) => {
      reportFailure = error instanceof Error ? error : new Error(String(error))
      controller.abort(error)
    })
  }
  const flush = () => {
    if (!buffer) return
    enqueue(bufferKind, bufferKind === 'llm.reasoning' ? '模型推理片段' : '模型响应片段', buffer)
    buffer = ''
  }
  const stopEvents = ctx.on('session/event', (session, event) => {
    if (session.id !== sessionId) return
    if (event.type === 'turn/end') stopReason = event.data.reason.kind
    if (event.type === 'tool/call') {
      flush()
      enqueue('llm.tool-call', event.data.name, event.data.arguments, event.data.callId)
    } else if (event.type === 'tool/result') {
      enqueue('llm.tool-result', '工具执行结果', JSON.stringify(event.data), event.data.message.source.callId)
    } else if (event.type === 'assistant/message') {
      flush()
      answer = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      enqueue('llm.response', '模型完整响应', answer)
    } else if (['step/start', 'step/end', 'turn/end', 'assistant/attempt'].includes(event.type)) {
      enqueue(event.type, event.type, JSON.stringify(event.data))
    }
  })
  const stopStream = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (agent.session.id !== sessionId || frame.type !== 'chunk') return
    const chunk = frame.chunk
    if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return
    chars += chunk.text.length
    if (chars > config.modelOutputLimitChars) {
      controller.abort(new Error('Model output exceeds limit'))
      return
    }
    const kind = chunk.type === 'reasoning-delta' ? 'llm.reasoning' : 'llm.response'
    if (kind !== bufferKind) flush()
    bufferKind = kind
    buffer += chunk.text
    if (buffer.length >= 512) flush()
  })
  try {
    const prompt = [
      'Generate one self-contained ECMAScript .mjs script with no dependencies.',
      'Do not execute the generated script; a later workflow node executes it.',
      'Your final response must contain exactly one fenced javascript code block and no prose outside it.',
      'Task: ' + instruction,
    ].join('\n')
    await node.report({ kind: 'llm.request', title: selection.provider + '/' + selection.model, detail: prompt, sessionId })
    const handle = await ctx.agents.create({ sessionId, meta: { cwd }, agentOptions: selection, signal: controller.signal })
    const cancel = () =>{  handle.agent.cancel({ kind: 'parent' }) }
    controller.signal.addEventListener('abort', cancel, { once: true })
    try {
      controller.signal.throwIfAborted()
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      flush()
      await reports
      controller.signal.throwIfAborted()
      if (reportFailure !== undefined) throw reportFailure
      if (stopReason !== 'completed') {
        throw new Error('Agent did not complete: ' + (stopReason ?? 'no turn')
          + '. Check the current DSH model and API key configuration.')
      }
      const match = /```(?:javascript|js|mjs)?\s*\n([\s\S]*?)```/i.exec(answer)
      if (!match?.[1]?.trim()) throw new Error('Model did not return a fenced JavaScript script')
      return { filename: 'generated-demo.mjs', code: match[1].trim() + '\n', sessionId }
    } finally {
      controller.signal.removeEventListener('abort', cancel)
      await handle.dispose()
    }
  } finally {
    stopEvents()
    stopStream()
    clearTimeout(timeout)
    node.signal.removeEventListener('abort', relay)
    await reports
  }
}

async function executeScript(
  ctx: Context, config: Required<MorningScriptDemoConfig>, cwd: string, code: string, node: WorkflowNodeContext,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; artifactPath: string; sandboxEnforcement: string }> {
  node.signal.throwIfAborted()
  const artifactPath = join(cwd, 'generated-demo.mjs')
  await writeFile(artifactPath, code, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  const requested = [process.execPath, artifactPath]
  const policy = ctx.sandboxPolicy.resolve()
  const signal = AbortSignal.any([node.signal, AbortSignal.timeout(config.timeoutMs)])
  const confined = policy.mode === 'danger-full-access' ? undefined
    : ctx.sandbox.confine(requested, { ...policy, mode: policy.mode, workspaceRoot: cwd })
  await node.report({ kind: 'process.start', title: '执行脚本', detail: JSON.stringify(requested) })
  const child = ctx.subprocess.spawn({
    argv: confined?.argv ?? requested, cwd, signal, graceMs: 2000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: config.outputLimitBytes }, stderr: { maxBytes: config.outputLimitBytes } },
  })
  const result = await child.done
  const stdout = child.collected.stdout?.readFrom(0)
  const stderr = child.collected.stderr?.readFrom(0)
  if (!stdout || !stderr) throw new Error('Subprocess output collection is unavailable')
  await node.report({ kind: 'process.result', title: '脚本执行结果',
    detail: JSON.stringify({ exitCode: result.exitCode, stdout: stdout.text, stderr: stderr.text }) })
  signal.throwIfAborted()
  if (result.exitCode !== 0) throw new Error('Script failed: ' + String(result.exitCode) + '\n' + stderr.text)
  return { stdout: stdout.text, stderr: stderr.text, exitCode: result.exitCode,
    artifactPath, sandboxEnforcement: confined?.enforcement ?? 'none' }
}

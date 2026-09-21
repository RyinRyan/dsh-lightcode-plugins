/** Deterministic release-readiness workflow used to validate Factory extension contracts. */
import type { WorkflowNodeContext, WorkflowRegistration } from 'lightcode-factory-contracts/workflow'

const normalizeInputNode = { id: 'normalize-input', name: '规范化输入' } as const
const assessRiskNode = { id: 'assess-risk', name: '评估风险' } as const
const buildChecklistNode = { id: 'build-checklist', name: '生成发布检查清单' } as const

const RISK_KEYWORDS = [
  ['data-migration', /数据迁移|database migration|schema/i, '涉及数据或结构迁移'],
  ['breaking-change', /破坏性|breaking/i, '包含破坏性变更'],
  ['security', /安全|security/i, '涉及安全变更'],
  ['rollback', /回滚|rollback/i, '需要回滚准备'],
  ['performance', /性能|performance|内存泄漏/i, '涉及性能或资源风险'],
] as const

type VersionParts = {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: string | null
}

type NormalizedInput = {
  readonly project: string
  readonly version: string
  readonly versionParts: VersionParts
  readonly riskNoteCount: number
  readonly matchedKeywords: string[]
}

type RiskFactor = {
  readonly code: string
  readonly weight: number
  readonly reason: string
}

type RiskAssessment = {
  readonly score: number
  readonly level: 'low' | 'medium' | 'high'
  readonly factors: RiskFactor[]
  readonly consideredNotes: number
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

async function normalizeInput(
  input: Readonly<Record<string, string>>, node: WorkflowNodeContext,
): Promise<NormalizedInput> {
  node.signal.throwIfAborted()
  await node.log('开始规范化发布输入')
  const project = collapseWhitespace(input.project ?? '')
  const version = collapseWhitespace(input.version ?? '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version)
  if (!match) throw new Error('版本号必须使用 X.Y.Z 或 X.Y.Z-prerelease 格式')
  const rawNotes = (input.riskNotes ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean).slice(0, 50)
  const matchedKeywords = RISK_KEYWORDS.filter(([, pattern]) => rawNotes.some(note => pattern.test(note))).map(([code]) => code)
  const normalized: NormalizedInput = {
    project,
    version,
    versionParts: {
      major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null,
    },
    riskNoteCount: rawNotes.length,
    matchedKeywords,
  }
  node.signal.throwIfAborted()
  await node.report({
    kind: 'release.input', title: '输入规范化完成',
    detail: JSON.stringify({ project, version, riskNoteCount: rawNotes.length, prerelease: match[4] !== undefined }),
  })
  return normalized
}

async function assessRisk(input: NormalizedInput, node: WorkflowNodeContext): Promise<RiskAssessment> {
  node.signal.throwIfAborted()
  await node.log('开始确定性风险评分')
  const factors: RiskFactor[] = []
  if (input.versionParts.prerelease !== null) factors.push({ code: 'prerelease', weight: 3, reason: '版本包含预发布标识' })
  if (input.riskNoteCount > 0) factors.push({ code: 'notes-present', weight: 1, reason: '存在人工补充的风险备注' })
  if (input.versionParts.major === 0) factors.push({ code: 'zero-major', weight: 1, reason: '主版本号为 0，接口可能仍不稳定' })
  for (const [code, , reason] of RISK_KEYWORDS) {
    if (input.matchedKeywords.includes(code)) factors.push({ code, weight: 2, reason })
  }
  const score = factors.reduce((total, factor) => total + factor.weight, 0)
  const assessment: RiskAssessment = {
    score,
    level: score >= 5 ? 'high' : score >= 2 ? 'medium' : 'low',
    factors,
    consideredNotes: input.riskNoteCount,
  }
  node.signal.throwIfAborted()
  await node.report({
    kind: 'release.risk', title: '风险评分完成',
    detail: JSON.stringify({ score: assessment.score, level: assessment.level, factorCodes: factors.map(value => value.code) }),
  })
  return assessment
}

async function buildChecklist(
  input: NormalizedInput, assessment: RiskAssessment, node: WorkflowNodeContext,
) {
  node.signal.throwIfAborted()
  await node.log('开始生成发布检查清单')
  const checklist = [
    { id: 'typecheck', title: '运行 TypeScript 类型检查', required: true, reason: '阻止类型契约漂移' },
    { id: 'tests', title: '运行单元测试与 Loader 组合测试', required: true, reason: '验证行为与装配' },
    { id: 'build', title: '构建 Host 产物', required: true, reason: '验证发布入口' },
    { id: 'pack', title: '打包真实 tarball', required: true, reason: '验证依赖闭包' },
    { id: 'isolated-install', title: '在隔离 Profile 安装并启动验证', required: true, reason: '排除 workspace link 影响' },
    { id: 'review-signoff', title: '完成人工发布评审', required: true, reason: '保留最终发布门禁' },
  ]
  if (assessment.level !== 'low') {
    checklist.push(
      { id: 'rollback-plan', title: '准备并演练回滚方案', required: true, reason: '中高风险发布需要可逆路径' },
      { id: 'migration-notes', title: '核对升级与迁移说明', required: true, reason: '降低版本切换风险' },
    )
  }
  if (assessment.level === 'high') {
    checklist.push(
      { id: 'staged-rollout', title: '按灰度批次发布', required: true, reason: '限制高风险变更影响范围' },
      { id: 'data-backup', title: '确认数据备份有效', required: true, reason: '支持高风险变更恢复' },
      { id: 'security-review', title: '补充安全审查', required: true, reason: '检查高风险输入与变更' },
    )
  }
  const output = {
    checklist,
    summary: { project: input.project, version: input.version, riskLevel: assessment.level, total: checklist.length },
  }
  node.signal.throwIfAborted()
  await node.report({
    kind: 'release.checklist', title: '发布检查清单已生成',
    detail: JSON.stringify({ total: checklist.length, riskLevel: assessment.level }),
  })
  return output
}

export const releaseReadinessWorkflow: WorkflowRegistration = {
  id: 'release-readiness',
  version: '1.1.0',
  name: '发布就绪评估',
  description: '对目标版本进行确定性风险评分并生成发布检查清单',
  parameters: [
    { name: 'project', label: '项目名称', required: true },
    { name: 'version', label: '目标版本', required: true },
    { name: 'riskNotes', label: '补充风险备注（不得包含凭据）', required: false, defaultValue: '' },
  ],
  nodes: [normalizeInputNode, assessRiskNode, buildChecklistNode],
  async execute(run) {
    const normalized = await run.node(normalizeInputNode, node => normalizeInput(run.input, node))
    const assessment = await run.node(assessRiskNode, node => assessRisk(normalized, node))
    await run.node(buildChecklistNode, node => buildChecklist(normalized, assessment, node))
  },
}

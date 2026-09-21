#!/usr/bin/env node
import { access, readFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const args = process.argv.slice(2)
const built = args.includes('--built')
const docs = args.includes('--docs')
const designFlagIndex = args.indexOf('--design')
const designArg = designFlagIndex === -1 ? undefined : args[designFlagIndex + 1]
const positionalArgs = args.filter((arg, index) => arg !== '--built' && arg !== '--docs' && arg !== '--design' && index !== designFlagIndex + 1)
const rootArg = positionalArgs[0] ?? process.cwd()
const root = resolve(rootArg)
const errors = []
const warnings = []
if (designFlagIndex !== -1 && designArg === undefined) errors.push('--design 缺少设计文档路径')

async function exists(path) {
  try { await access(path, constants.F_OK); return true } catch { return false }
}

async function manifest(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { errors.push(`${path}: package.json 无效或无法读取（${error.message}）`); return undefined }
}

async function auditDesign(pathArg) {
  const path = resolve(root, pathArg)
  if (!await exists(path)) {
    errors.push(`设计文档不存在：${path}`)
    return
  }

  const source = await readFile(path, 'utf8')
  const relativePath = relative(root, path).replaceAll('\\', '/')
  const workflowDesign = relativePath.startsWith('.design/workflows/')
  const changeDesign = relativePath.startsWith('.design/changes/')
  if (!workflowDesign && !changeDesign) errors.push(`${path}: 设计必须位于 .design/workflows/ 或 .design/changes/`)

  const idLabel = workflowDesign ? 'Workflow ID' : 'Change ID'
  const idMatch = source.match(new RegExp(`^- ${idLabel}:\\s*\x60([a-z0-9]+(?:-[a-z0-9]+)*)\x60\\s*$`, 'm'))
  if (idMatch === null) {
    errors.push(`${path}: 缺少合法的 ${idLabel} 元数据`)
  } else if (basename(path, '.md') !== idMatch[1]) {
    errors.push(`${path}: 文件名必须与 ${idLabel} ${idMatch[1]} 一致`)
  }

  const requiredHeadings = workflowDesign ? [
    '需求与目标', '底座适配结论', '输入参数', '节点与执行顺序', '输出与页面映射',
    '观测设计', '状态、失败与取消', '安全与数据边界', '依赖与配置',
    'Workspace 与 Bundle 接线', '测试与验收', '文档同步', '限制与非目标', '设计自检',
  ] : [
    '需求与成功标准', '组件选择与职责边界', '当前实现证据', '目标契约与数据流',
    '状态、并发与生命周期', '持久化、Remote 与兼容性', 'Web 与交互',
    '安全与数据边界', '实现与接线计划', '测试与验收', '文档同步', '风险、限制与回滚', '设计自检',
  ]
  for (const heading of requiredHeadings) {
    if (!new RegExp(`^##\\s+\\d+\\.\\s+${escapeRegExp(heading)}\\s*$`, 'm').test(source)) {
      errors.push(`${path}: 缺少章节“${heading}”`)
    }
  }

  if (/\{\{(?:WORKFLOW|CHANGE)_(?:ID|NAME|TYPE)\}\}|\[填写(?:[^\]]*)?\]/.test(source)) {
    errors.push(`${path}: 仍包含未填写的模板占位符`)
  }
  if (/^- \[ \]/m.test(source)) errors.push(`${path}: 设计自检仍有未勾选项目`)
  if (!/^- 设计状态:\s*(?:已自检|已实现并验证)\s*$/m.test(source)) {
    errors.push(`${path}: 设计状态必须为“已自检”或“已实现并验证”`)
  }
  if (workflowDesign && !/^- 底座适配类型:\s*(?:普通 Workflow|平台能力扩展)\s*$/m.test(source)) {
    errors.push(`${path}: 底座适配类型必须明确为“普通 Workflow”或“平台能力扩展”`)
  }
  if (changeDesign && !/^- 变更类型:\s*`?(?:runtime|storage|web|cross-cutting)`?\s*$/m.test(source)) {
    errors.push(`${path}: 变更类型必须为 runtime、storage、web 或 cross-cutting`)
  }
}

async function auditRepositoryDocs() {
  const required = [
    'AGENTS.md', 'docs/architecture.md',
    '.claude/skills/lightcode-factory-develop/SKILL.md',
    '.claude/skills/lightcode-factory-develop/references/component-selection.md',
    '.claude/skills/lightcode-factory-develop/references/runtime-development.md',
    '.claude/skills/lightcode-factory-develop/references/storage-development.md',
    '.claude/skills/lightcode-factory-develop/references/web-development.md',
    '.claude/skills/lightcode-factory-develop/references/documentation-sync.md',
  ]
  for (const file of required) if (!await exists(join(root, file))) errors.push(`缺少 Agent 开发文档：${file}`)

  for (const file of ['README.md', 'AGENTS.md', 'docs/architecture.md', '.claude/skills/lightcode-factory-develop/SKILL.md']) {
    const path = join(root, file)
    if (!await exists(path)) continue
    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]
      if (/^(?:https?:|#)/.test(target)) continue
      if (!await exists(resolve(dirname(path), target))) errors.push(`${file} 链接目标不存在：${target}`)
    }
  }
}

function gitLines(args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (result.status !== 0) return undefined
  return result.stdout.split(/\r?\n/).map(value => value.trim().replaceAll('\\', '/')).filter(Boolean)
}

async function auditDocumentationChanges() {
  const tracked = gitLines(['diff', '--name-only', 'HEAD'])
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard'])
  if (tracked === undefined || untracked === undefined) {
    warnings.push('无法读取 Git 变更，跳过文档同步映射检查')
    return
  }
  const changed = new Set([...tracked, ...untracked])
  const has = (predicate) => [...changed].some(predicate)
  const exact = (path) => changed.has(path)
  const designChanged = (kind) => has(path => path.startsWith(`.design/${kind}/`) && path.endsWith('.md'))

  if (has(path => path.startsWith('packages/contracts/src/') || path === 'packages/contracts/package.json')
    && !(exact('docs/architecture.md') && designChanged('changes'))) {
    errors.push('Contracts 源码有变化，但缺少 docs/architecture.md 和 .design/changes/ 的同步变更')
  }
  if (has(path => path.startsWith('packages/runtime/src/') || path === 'packages/runtime/package.json')
    && !(exact('docs/architecture.md') && designChanged('changes'))) {
    errors.push('Runtime 源码有变化，但缺少 docs/architecture.md 和 .design/changes/ 的同步变更')
  }
  if (has(path => path.startsWith('packages/storage-sqlite/src/') || path === 'packages/storage-sqlite/package.json')
    && !(exact('docs/architecture.md') && designChanged('changes'))) {
    errors.push('SQLite Storage 源码有变化，但缺少 docs/architecture.md 和 .design/changes/ 的同步变更')
  }
  if (has(path => path.startsWith('packages/web/src/') || path === 'packages/web/package.json')
    && !(exact('docs/architecture.md') && designChanged('changes'))) {
    errors.push('Web 源码有变化，但缺少 docs/architecture.md 和 .design/changes/ 的同步变更')
  }
  const workflowSourceChanged = has(path => path.startsWith('packages/workflows/src/') || path === 'packages/workflows/package.json')
  if (workflowSourceChanged && !(designChanged('workflows') || designChanged('changes'))) {
    errors.push('Workflow Catalog 源码有变化，但缺少对应设计变更')
  }
  const bundleChanged = has(path => path.startsWith('packages/factory/')
    || ['package.json', 'package-lock.json', 'scripts/build.mjs', 'scripts/pack.mjs'].includes(path))
  if (bundleChanged && !exact('README.md')) errors.push('Bundle/构建装配有变化，但 README.md 未同步')
}

const rootManifest = await manifest(join(root, 'package.json'))
if (rootManifest === undefined) process.exitCode = 1
await auditRepositoryDocs()
if (docs) await auditDocumentationChanges()

const packageDirs = []
if (await exists(join(root, 'packages'))) {
  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (entry.isDirectory() && await exists(join(root, 'packages', entry.name, 'package.json'))) {
      packageDirs.push(join(root, 'packages', entry.name))
    }
  }
} else if (rootManifest !== undefined) packageDirs.push(root)

const names = new Set()
const packages = []
for (const dir of packageDirs) {
  const file = join(dir, 'package.json')
  const pkg = await manifest(file)
  if (pkg === undefined) continue
  packages.push({ dir, file, pkg, folder: relative(join(root, 'packages'), dir).replaceAll('\\', '/') })
  if (typeof pkg.name !== 'string' || pkg.name.length === 0) errors.push(`${file}: 缺少包名`)
  else if (names.has(pkg.name)) errors.push(`${file}: 包名重复：${pkg.name}`)
  else names.add(pkg.name)

  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const [name, value] of Object.entries(pkg[section] ?? {})) {
      if (typeof value === 'string' && (value.startsWith('file:') || isAbsolute(value))) {
        warnings.push(`${pkg.name}: ${section}.${name} 使用了不可移植的依赖地址 ${value}`)
      }
    }
  }

  if (pkg.dsh?.client !== undefined) {
    const client = pkg.exports?.['./client']
    if (client === undefined) errors.push(`${pkg.name}: 声明了 dsh.client，但缺少 exports["./client"]`)
    const output = typeof client === 'string' ? client : client?.default
    if (typeof output !== 'string') errors.push(`${pkg.name}: ./client 没有默认 JavaScript 导出`)
    else if (built && !await exists(join(dir, output.replace(/^\.\//, '')))) errors.push(`${pkg.name}: 缺少已构建的 Client 产物：${output}`)
    const files = Array.isArray(pkg.files) ? pkg.files : []
    if (!files.some(value => value === 'lib' || value === 'lib/client.js' || value === output?.replace(/^\.\//, ''))) {
      warnings.push(`${pkg.name}: files 可能未包含 Client 产物 ${output ?? '（未知）'}`)
    }
  }

  const patch = pkg.dsh?.bundle?.patch
  if (patch !== undefined) {
    if (typeof patch !== 'string') errors.push(`${pkg.name}: dsh.bundle.patch 必须是字符串`)
    else if (!await exists(join(dir, patch.replace(/^\.\//, '')))) errors.push(`${pkg.name}: 缺少 Bundle patch：${patch}`)
    const bundled = new Set(pkg.bundleDependencies ?? pkg.bundledDependencies ?? [])
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (!bundled.has(name)) warnings.push(`${pkg.name}: 依赖 ${name} 未列入 bundleDependencies`)
    }
  }

  if (built) {
    for (const field of ['main', 'types']) {
      const value = pkg[field]
      if (typeof value === 'string' && !await exists(join(dir, value))) errors.push(`${pkg.name}: 缺少 ${field} 产物：${value}`)
    }
  }
}

if (packageDirs.length === 0) errors.push(`${root}: 根目录和 packages/* 下均未找到 package.json`)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionsFolder(source, folder) {
  const escaped = escapeRegExp(folder)
  return new RegExp(`(?:['"]${escaped}['"]|packages[\\\\/]${escaped}(?:[\\\\/]|['"\x60]))`).test(source)
}

const byName = new Map(packages.map(value => [value.pkg.name, value]))
const factoryBundles = packages.filter(value => value.pkg.dsh?.bundle !== undefined)
const contracts = byName.get('lightcode-factory-contracts')
for (const workflow of packages.filter(value => value.pkg.name === 'lightcode-factory-workflows')) {
  if (workflow.pkg.dsh?.client !== undefined || workflow.pkg.exports?.['./client'] !== undefined) {
    errors.push(`${workflow.pkg.name}: Workflow Catalog 应复用 Factory Web，不应声明 Browser Client`)
  }
  if (contracts === undefined) {
    errors.push(`${workflow.pkg.name}: workspace 缺少 lightcode-factory-contracts`)
  } else if (workflow.pkg.dependencies?.['lightcode-factory-contracts'] !== contracts.pkg.version) {
    errors.push(`${workflow.pkg.name}: lightcode-factory-contracts 依赖必须与 workspace Contracts 版本 ${contracts.pkg.version} 一致`)
  }
  if (workflow.pkg.peerDependencies?.['@deepseek-ai/cordis'] === undefined) {
    errors.push(`${workflow.pkg.name}: 缺少 @deepseek-ai/cordis peerDependency`)
  }
  for (const bundle of factoryBundles) {
    if (workflow.pkg.version !== bundle.pkg.version) {
      errors.push(`${workflow.pkg.name}: 版本 ${workflow.pkg.version} 与 Factory Bundle ${bundle.pkg.version} 不一致`)
    }
  }
}

for (const bundle of factoryBundles) {
  const dependencies = bundle.pkg.dependencies ?? {}
  const bundled = bundle.pkg.bundleDependencies ?? bundle.pkg.bundledDependencies ?? []
  for (const name of bundled) {
    if (!(name in dependencies)) errors.push(`${bundle.pkg.name}: bundleDependencies 中的 ${name} 不在 dependencies`)
    const member = byName.get(name)
    if (member !== undefined && dependencies[name] !== member.pkg.version) {
      errors.push(`${bundle.pkg.name}: dependencies.${name}=${dependencies[name]}，与 workspace 成员版本 ${member.pkg.version} 不一致`)
    }
  }
  const patchPath = bundle.pkg.dsh?.bundle?.patch
  if (typeof patchPath === 'string' && await exists(join(bundle.dir, patchPath.replace(/^\.\//, '')))) {
    const patch = await readFile(join(bundle.dir, patchPath.replace(/^\.\//, '')), 'utf8')
    for (const name of bundled.filter(name => name !== 'lightcode-factory-contracts')) {
      const pattern = new RegExp(`\\bname:\\s*['"]?${escapeRegExp(name)}['"]?(?:\\s|$)`)
      if (!pattern.test(patch)) errors.push(`${bundle.pkg.name}: Bundle patch 未装配 ${name}`)
    }
  }
}

const buildPath = join(root, 'scripts', 'build.mjs')
const packPath = join(root, 'scripts', 'pack.mjs')
const buildSource = await exists(buildPath) ? await readFile(buildPath, 'utf8') : undefined
const packSource = await exists(packPath) ? await readFile(packPath, 'utf8') : undefined
let hostReferences
const hostConfigPath = join(root, 'tsconfig.host.json')
if (await exists(hostConfigPath)) {
  try {
    const hostConfig = JSON.parse(await readFile(hostConfigPath, 'utf8'))
    hostReferences = new Set((hostConfig.references ?? []).map(value => String(value.path).replaceAll('\\', '/')))
  } catch (error) {
    errors.push(`${hostConfigPath}: 无法检查 references（${error.message}）`)
  }
}

for (const member of packages.filter(value => value.pkg.dsh?.bundle === undefined)) {
  if (!await exists(join(member.dir, 'src', 'index.ts'))) continue
  if (buildSource !== undefined && !mentionsFolder(buildSource, member.folder)) {
    errors.push(`${member.pkg.name}: scripts/build.mjs 未包含 packages/${member.folder}`)
  }
  if (packSource !== undefined && !mentionsFolder(packSource, member.folder)) {
    errors.push(`${member.pkg.name}: scripts/pack.mjs 未包含 packages/${member.folder}`)
  }
  if (hostReferences !== undefined) {
    const localConfig = await exists(join(member.dir, 'tsconfig.host.json')) ? 'tsconfig.host.json' : 'tsconfig.json'
    const expected = `packages/${member.folder}/${localConfig}`
    if (!hostReferences.has(expected)) errors.push(`${member.pkg.name}: tsconfig.host.json 缺少 reference ${expected}`)
  }
}

const lockPath = join(root, 'package-lock.json')
if (await exists(lockPath)) {
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'))
    for (const member of packages) {
      const key = `packages/${member.folder}`
      if (lock.packages?.[key]?.version !== member.pkg.version) {
        errors.push(`${member.pkg.name}: package-lock.json 的 ${key} 版本未同步`)
      }
    }
  } catch (error) {
    errors.push(`${lockPath}: 无法检查 workspace 版本（${error.message}）`)
  }
}

if (designArg !== undefined) await auditDesign(designArg)

for (const warning of warnings) console.warn(`警告 ${warning}`)
for (const error of errors) console.error(`错误 ${error}`)
console.log(`已审计 ${packageDirs.length} 个 LightCode Factory 包及 Agent 文档：${errors.length} 个错误，${warnings.length} 个警告。`)
if (errors.length > 0) process.exitCode = 1

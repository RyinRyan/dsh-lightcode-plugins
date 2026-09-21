#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , workflowId, workflowName = workflowId, rootArg = process.cwd()] = process.argv

if (workflowId === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workflowId)) {
  console.error('用法：node init-workflow-design.mjs <kebab-case-workflow-id> [工作流名称] [factory-root]')
  process.exit(1)
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const templatePath = resolve(scriptDir, '..', 'templates', 'workflow-design.md')
const root = resolve(rootArg)
const outputPath = join(root, '.design', 'workflows', `${workflowId}.md`)

try {
  await access(join(root, 'package.json'), constants.F_OK)
} catch {
  console.error(`Factory 根目录无效，缺少 package.json：${root}`)
  process.exit(1)
}

try {
  await access(outputPath, constants.F_OK)
  console.error(`设计文档已存在，拒绝覆盖：${outputPath}`)
  process.exit(1)
} catch {
  // 文件不存在时继续创建。
}

const template = await readFile(templatePath, 'utf8')
const content = template
  .replaceAll('{{WORKFLOW_ID}}', workflowId)
  .replaceAll('{{WORKFLOW_NAME}}', workflowName ?? workflowId)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, content, 'utf8')
console.log(outputPath)

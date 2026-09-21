#!/usr/bin/env node
import { access, readFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const built = args.includes('--built')
const rootArg = args.find(arg => arg !== '--built') ?? process.cwd()
const root = resolve(rootArg)
const errors = []
const warnings = []

async function exists(path) {
  try { await access(path, constants.F_OK); return true } catch { return false }
}

async function manifest(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { errors.push(`${path}: package.json 无效或无法读取（${error.message}）`); return undefined }
}

const rootManifest = await manifest(join(root, 'package.json'))
if (rootManifest === undefined) process.exitCode = 1

const packageDirs = []
if (await exists(join(root, 'packages'))) {
  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (entry.isDirectory() && await exists(join(root, 'packages', entry.name, 'package.json'))) {
      packageDirs.push(join(root, 'packages', entry.name))
    }
  }
} else if (rootManifest !== undefined) packageDirs.push(root)

const names = new Set()
for (const dir of packageDirs) {
  const file = join(dir, 'package.json')
  const pkg = await manifest(file)
  if (pkg === undefined) continue
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

for (const warning of warnings) console.warn(`警告 ${warning}`)
for (const error of errors) console.error(`错误 ${error}`)
console.log(`已审计 ${packageDirs.length} 个包：${errors.length} 个错误，${warnings.length} 个警告。`)
if (errors.length > 0) process.exitCode = 1

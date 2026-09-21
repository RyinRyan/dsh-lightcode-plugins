import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { InstalledPackage } from '../shared/protocol.js'

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function readJson(path: string): JsonObject | null {
  try { return object(JSON.parse(readFileSync(path, 'utf8')) as unknown) } catch { return null }
}

function sourceOf(spec: unknown): InstalledPackage['source'] {
  if (typeof spec !== 'string') return 'unknown'
  if (spec.startsWith('file:') || isAbsolute(spec)) return 'local-file'
  if (spec.startsWith('git+') || spec.startsWith('git@') || spec.startsWith('github:')) return 'git'
  return /^([~^]|[<>=*\d])/.test(spec) || spec === 'latest' ? 'registry' : 'unknown'
}

function packagePath(nodeModules: string, name: string): string | null {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) return null
  const path = resolve(nodeModules, ...name.split('/'))
  return path.startsWith(`${nodeModules}${sep}`) ? path : null
}

/** Read direct profile dependencies only; dependency specs are never exposed to the browser. */
export function listInstalledPackages(profileDirectory: string): InstalledPackage[] {
  const manifest = readJson(join(profileDirectory, 'package.json'))
  const dependencies = object(manifest?.dependencies)
  if (dependencies === null) return []
  const nodeModules = resolve(profileDirectory, 'node_modules')
  if (!existsSync(nodeModules)) return []
  return Object.entries(dependencies).flatMap(([name, spec]) => {
    const directory = packagePath(nodeModules, name)
    const installed = directory === null ? null : readJson(join(directory, 'package.json'))
    const dsh = object(installed?.dsh)
    return [{
      name,
      version: typeof installed?.version === 'string' ? installed.version : null,
      ...(typeof installed?.description === 'string' ? { description: installed.description.slice(0, 280) } : {}),
      source: sourceOf(spec),
      isDshPlugin: dsh !== null && (object(dsh.bundle) !== null || object(dsh.client) !== null),
    }]
  }).sort((left, right) => left.name.localeCompare(right.name))
}

/** Matches DSH's default on-disk profile location when profileContext.dir is unavailable. */
export function defaultProfileDirectory(profile: string): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', profile)
}

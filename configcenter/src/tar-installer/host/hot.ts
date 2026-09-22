/** Live (hot) mounting of freshly installed packages into the running host. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Activation } from '../shared/protocol.js'

interface PluginHandle {
  await(): Promise<unknown>
  dispose(): Promise<unknown> | void
}

/** Structural slice of a Cordis context; keeps this module free of hard dependencies. */
export interface HotContext {
  plugin(plugin: unknown, config: unknown): PluginHandle
  logger?: { info?(message: string): void; warn?(message: string): void }
}

interface Row {
  readonly id: string
  readonly name: string
}

// Hot mounts are process-scoped by design: they only exist until this host exits.
const mounted = new Map<string, PluginHandle>()
let includeClass: unknown | null | undefined
let sequence = 0

/** Only plain insert patches can be faithfully represented in the live Include subtree. */
export function parseHotPatch(text: string): Row[] | null {
  const rows: Row[] = []
  let id: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (line.trim() === '' || /^-\s+insert:\s*$/.test(line)) continue
    const nextId = /^\s+-\s+id:\s*(\S+)\s*$/.exec(line)
    if (nextId !== null) {
      if (id !== null) return null
      id = nextId[1] ?? null
      continue
    }
    const name = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (name !== null && id !== null) {
      rows.push({ id, name: name[1] ?? '' })
      id = null
      continue
    }
    return null
  }
  return id === null && rows.length > 0 ? rows : null
}

async function includeTree(): Promise<unknown | null> {
  if (includeClass !== undefined) return includeClass
  try {
    // The specifier is concatenated so bundlers cannot resolve it at build
    // time: the Include class must come from the profile's runtime copy of
    // cordis-plugin-include, not from a second copy inlined into this bundle.
    const specifier = '@deepseek-ai/' + 'cordis-plugin-include'
    const mod = await import(specifier) as { Include?: new (...args: never[]) => { write(): void } }
    if (mod.Include === undefined) throw new Error('Include is unavailable')
    class EphemeralInclude extends mod.Include {
      override write(): void {}
    }
    includeClass = EphemeralInclude
  } catch {
    includeClass = null
  }
  return includeClass
}

function profileEntry(profileDirectory: string, packageName: string): string {
  try {
    return pathToFileURL(createRequire(join(profileDirectory, 'package.json')).resolve(packageName)).href
  } catch {
    return packageName
  }
}

/** Mount a newly added package into this process. Durable activation stays owned by DSH's profile bundles. */
export async function hotMount(ctx: HotContext, profileDirectory: string, packageName: string): Promise<Activation> {
  if (mounted.has(packageName)) return { state: 'live' }
  try {
    const Include = await includeTree()
    if (Include === null) {
      return { state: 'restart-required', reasonCode: 'include-unavailable', reason: 'this DSH host does not provide Include-based hot mounting' }
    }
    const root = join(profileDirectory, 'node_modules', ...packageName.split('/'))
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8').catch(() => null)
    if (patch === null) {
      return { state: 'restart-required', reasonCode: 'patch-missing', reason: 'package has no cordis.patch.yml to hot-mount' }
    }
    const rows = parseHotPatch(patch)
    if (rows === null) {
      return { state: 'restart-required', reasonCode: 'patch-unsupported', reason: 'bundle patch contains config or expressions that cannot be hot-mounted safely' }
    }
    const directory = join(profileDirectory, '.dsh-tar-installer', 'hot')
    await mkdir(directory, { recursive: true })
    const file = join(directory, `mount-${String(++sequence)}.yml`)
    const yml = rows.map(row => `- id: 'dti-${row.id}'\n  name: '${profileEntry(profileDirectory, row.name)}'\n`).join('')
    await writeFile(file, yml, { encoding: 'utf8', mode: 0o600 })
    const handle = ctx.plugin(Include, { path: pathToFileURL(file).href })
    try {
      await handle.await()
    } catch (error) {
      try {
        await handle.dispose()
      } catch { /* best effort */ }
      await rm(file, { force: true })
      throw error
    }
    mounted.set(packageName, handle)
    ctx.logger?.info?.(`[configcenter] hot-mounted ${packageName}`)
    return { state: 'live' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger?.warn?.(`[configcenter] hot mount failed for ${packageName}: ${message}`)
    return { state: 'restart-required', reasonCode: 'mount-failed', reason: `hot mount failed: ${message}` }
  }
}

/** Dispose a package this installer mounted into the current process. */
export async function hotUnmount(packageName: string): Promise<boolean> {
  const handle = mounted.get(packageName)
  if (handle === undefined) return false
  try {
    await handle.dispose()
  } catch {
    return false
  }
  mounted.delete(packageName)
  return true
}

/** Hot inputs are process-scoped; clear leftovers from a previous host before mounting. */
export async function cleanHotInputs(profileDirectory: string): Promise<void> {
  const directory = join(profileDirectory, '.dsh-tar-installer', 'hot')
  await rm(directory, { recursive: true, force: true })
}

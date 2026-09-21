import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PackagePreview } from '../shared/protocol.js'
import { inspectTarball } from './tarball.js'

interface StagedEntry {
  readonly path: string
  readonly preview: PackagePreview
  readonly expiresAt: number
}

/** Owns short-lived uploaded artifacts. Tokens never encode filesystem paths. */
export class StagingStore {
  readonly #directory: string
  readonly #ttlMs: number
  readonly #entries = new Map<string, StagedEntry>()

  constructor(directory = join(tmpdir(), `dsh-tar-installer-${String(process.pid)}`), ttlMs = 30 * 60 * 1000) {
    this.#directory = directory
    this.#ttlMs = ttlMs
  }

  async stage(bytes: Buffer, fileName: string): Promise<PackagePreview> {
    await this.cleanupExpired()
    const token = randomUUID()
    const inspected = inspectTarball(bytes, fileName)
    await mkdir(this.#directory, { recursive: true })
    const path = join(this.#directory, `${token}.tgz`)
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    const preview = { token, ...inspected }
    this.#entries.set(token, { path, preview, expiresAt: Date.now() + this.#ttlMs })
    return preview
  }

  peek(token: string): PackagePreview | null {
    const entry = this.#entries.get(token)
    if (entry === undefined || entry.expiresAt <= Date.now()) return null
    return entry.preview
  }

  async consume(token: string): Promise<{ path: string; preview: PackagePreview } | null> {
    await this.cleanupExpired()
    const entry = this.#entries.get(token)
    if (entry === undefined) return null
    this.#entries.delete(token)
    const bytes = await readFile(entry.path)
    const inspected = inspectTarball(bytes, entry.preview.fileName)
    if (inspected.sha256 !== entry.preview.sha256) {
      await rm(entry.path, { force: true })
      throw new Error('staged tarball changed after inspection')
    }
    return { path: entry.path, preview: entry.preview }
  }

  async removePath(path: string): Promise<void> {
    await rm(path, { force: true })
  }

  async cleanupExpired(): Promise<void> {
    const now = Date.now()
    const expired = [...this.#entries.entries()].filter(([, entry]) => entry.expiresAt <= now)
    for (const [token, entry] of expired) {
      this.#entries.delete(token)
      await rm(entry.path, { force: true })
    }
  }

  async dispose(): Promise<void> {
    this.#entries.clear()
    await rm(this.#directory, { recursive: true, force: true })
  }
}

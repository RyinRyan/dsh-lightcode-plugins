import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { PackagePreview } from '../shared/protocol.js'

const BLOCK = 512
const MAX_MANIFEST_BYTES = 1024 * 1024
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

export class TarballValidationError extends Error {}

interface Manifest {
  name?: unknown
  version?: unknown
  description?: unknown
  main?: unknown
  exports?: unknown
  dsh?: {
    bundle?: { patch?: unknown }
    client?: unknown
  }
}

function text(buffer: Buffer, offset: number, length: number): string {
  return buffer.toString('utf8', offset, offset + length).replace(/\0.*$/s, '')
}

function safeEntryPath(path: string): boolean {
  if (path === '' || path.includes('\\') || path.startsWith('/')) return false
  return !path.split('/').some(part => part === '' || part === '.' || part === '..')
}

/** Inspect an npm-style gzipped tar without extracting it to disk. */
export function inspectTarball(bytes: Buffer, fileName: string, maxExpandedBytes = 512 * 1024 * 1024): Omit<PackagePreview, 'token'> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new TarballValidationError('file is not a gzip-compressed tarball')
  }
  let tar: Buffer
  try {
    tar = gunzipSync(bytes, { maxOutputLength: maxExpandedBytes })
  } catch (error) {
    throw new TarballValidationError(`tarball cannot be decompressed safely: ${error instanceof Error ? error.message : String(error)}`)
  }
  let offset = 0
  let manifestBytes: Buffer | null = null
  while (offset + BLOCK <= tar.length) {
    const name = text(tar, offset, 100)
    if (name === '') break
    const prefix = text(tar, offset + 345, 155)
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (!safeEntryPath(path)) throw new TarballValidationError(`unsafe archive path: ${path}`)
    const rawSize = text(tar, offset + 124, 12).trim()
    const size = Number.parseInt(rawSize, 8)
    if (!Number.isSafeInteger(size) || size < 0) throw new TarballValidationError(`invalid tar entry size for ${path}`)
    const type = String.fromCharCode(tar[offset + 156] ?? 0)
    if (type === '1' || type === '2') throw new TarballValidationError(`archive links are not allowed: ${path}`)
    // PAX/GNU extension headers can replace the following entry path. This
    // narrow reader deliberately rejects them instead of validating one path
    // while the package manager later extracts another.
    if (!['\0', '0', '5'].includes(type)) throw new TarballValidationError(`unsupported tar entry type ${JSON.stringify(type)}: ${path}`)
    const dataOffset = offset + BLOCK
    const dataEnd = dataOffset + size
    if (dataEnd > tar.length) throw new TarballValidationError(`truncated tar entry: ${path}`)
    if ((type === '\0' || type === '0') && path === 'package/package.json') {
      if (size > MAX_MANIFEST_BYTES) throw new TarballValidationError('package.json is too large')
      manifestBytes = tar.subarray(dataOffset, dataEnd)
    }
    offset = dataOffset + Math.ceil(size / BLOCK) * BLOCK
  }
  if (manifestBytes === null) throw new TarballValidationError('tarball contains no package/package.json')
  let manifest: Manifest
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest
  } catch {
    throw new TarballValidationError('package/package.json is not valid JSON')
  }
  if (typeof manifest.name !== 'string' || !NPM_NAME.test(manifest.name)) {
    throw new TarballValidationError('package name is missing or invalid')
  }
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new TarballValidationError('package version is missing')
  }
  const hasBundlePatch = typeof manifest.dsh?.bundle?.patch === 'string'
  const hasClient = manifest.dsh?.client !== undefined
  const hasHost = typeof manifest.main === 'string' || manifest.exports !== undefined
  if (!hasBundlePatch && !hasClient) {
    throw new TarballValidationError('package does not declare dsh.bundle or dsh.client')
  }
  return {
    fileName,
    name: manifest.name,
    version: manifest.version,
    ...(typeof manifest.description === 'string' ? { description: manifest.description.slice(0, 500) } : {}),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    hasHost,
    hasClient,
    hasBundlePatch,
  }
}

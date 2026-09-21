import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackagePreview } from '../shared/protocol.js'

function fileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
}

/** Persist a tarball before pnpm records it as a file: dependency in the profile. */
export async function persistTarball(profileDirectory: string, stagedPath: string, preview: PackagePreview): Promise<string> {
  const directory = join(profileDirectory, '.dsh-tar-installer', 'tarballs')
  const filename = `${fileStem(preview.name)}-${fileStem(preview.version)}-${preview.sha256.slice(0, 16)}.tgz`
  const target = join(directory, filename)
  await mkdir(directory, { recursive: true })
  await copyFile(stagedPath, target)
  return target
}

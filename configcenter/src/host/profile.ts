/**
 * Profile discovery.
 *
 * The unified plugin serves whichever DSH profile hosts it. The name comes
 * from (in order) plugin config, the host-provided `profileContext` service,
 * `--profile` on the command line, and finally the `web` fallback.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Minimal structural view of Cordis' `profileContext` service. Kept
 * structural so this module never needs a hard dependency on the host types.
 */
export interface ProfileContextLike {
  readonly name?: unknown
  readonly dir?: unknown
}

/** Resolve `$DSH_HOME`, defaulting to `~/.dsh`. */
export function dshHome(): string {
  const override = process.env.DSH_HOME
  return resolve(override !== undefined && override.length > 0 ? override : join(homedir(), '.dsh'))
}

/** Fallback profile directory when `profileContext.dir` is unavailable. */
export function defaultProfileDirectory(profile: string): string {
  return join(dshHome(), 'profiles', profile)
}

function argvProfile(): string | undefined {
  const at = process.argv.indexOf('--profile')
  const value = at >= 0 ? process.argv[at + 1] : undefined
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function contextProfileName(profileContext: ProfileContextLike | undefined): string | undefined {
  return typeof profileContext?.name === 'string' && profileContext.name.length > 0
    ? profileContext.name
    : undefined
}

export function resolveProfileName(configured: string | undefined, profileContext: ProfileContextLike | undefined): string {
  return configured ?? contextProfileName(profileContext) ?? argvProfile() ?? 'web'
}

export function resolveProfileDirectory(profile: string, profileContext: ProfileContextLike | undefined): string {
  // A NUL byte can never appear in a real path; treat anything else as usable.
  if (typeof profileContext?.dir === 'string' && !profileContext.dir.includes('\0')) return profileContext.dir
  return defaultProfileDirectory(profile)
}

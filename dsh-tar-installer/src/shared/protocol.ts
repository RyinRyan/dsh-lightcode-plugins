/** Browser/Host protocol for the tarball installer. */
export const ROUTE_PREFIX = '/dsh-tar-installer'

export type OperationState = 'running' | 'succeeded' | 'failed'

export interface PackagePreview {
  readonly token: string
  readonly fileName: string
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly size: number
  readonly sha256: string
  readonly hasHost: boolean
  readonly hasClient: boolean
  readonly hasBundlePatch: boolean
}

export interface InstallOperation {
  readonly id: string
  readonly packageName: string
  readonly version: string
  readonly state: OperationState
  readonly startedAt: string
  readonly finishedAt?: string
  readonly exitCode?: number | null
  readonly timedOut?: boolean
  readonly output?: string
  readonly error?: string
  readonly activation?: { readonly state: 'live' | 'restart-required'; readonly reason?: string }
}

/** A direct dependency of the Profile currently serving this panel. */
export interface InstalledPackage {
  readonly name: string
  readonly version: string | null
  readonly description?: string
  readonly source: 'registry' | 'local-file' | 'git' | 'unknown'
  readonly isDshPlugin: boolean
}

export interface InstallerSnapshot {
  readonly profile: string
  readonly allowInstallScripts: boolean
  readonly maxUploadBytes: number
  readonly staged: PackagePreview | null
  readonly operation: InstallOperation | null
  readonly packages: readonly InstalledPackage[]
}

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export function apiOk<T>(value: T): ApiResult<T> {
  return { ok: true, value }
}

export function apiFail(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } }
}

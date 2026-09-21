/** Browser/Host wire protocol for the plugin installer. */
export { apiFail, apiOk } from '../../shared/api.js'
export type { ApiFail, ApiOk, ApiResult, WireErrorCode } from '../../shared/api.js'

export const ROUTE_PREFIX = '/dsh-tar-installer'

export type OperationState = 'running' | 'succeeded' | 'failed'

/**
 * Why an operation did not take effect in the live process. `reasonCode` is
 * stable so the browser can translate it; `reason` carries technical detail.
 */
export type ActivationReasonCode =
  | 'include-unavailable'
  | 'patch-missing'
  | 'patch-unsupported'
  | 'mount-failed'
  | 'not-mounted'

export interface Activation {
  readonly state: 'live' | 'restart-required'
  readonly reasonCode?: ActivationReasonCode
  readonly reason?: string
}

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
  readonly kind: 'install' | 'remove'
  readonly packageName: string
  readonly version: string
  readonly state: OperationState
  readonly startedAt: string
  readonly finishedAt?: string
  readonly exitCode?: number | null
  readonly timedOut?: boolean
  readonly output?: string
  readonly error?: string
  readonly activation?: Activation
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

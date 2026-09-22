/**
 * Wire envelope shared by every configuration-center HTTP route.
 *
 * Both the credential store and the plugin installer speak this exact JSON
 * shape, so the browser side needs a single transport helper instead of one
 * per legacy plugin.
 */

/** Stable error codes crossing the browser/Host boundary. */
export type WireErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'METHOD'
  | 'ORIGIN'
  | 'BUSY'
  | 'RESTART_DISABLED'
  | 'INTERNAL'

export interface ApiOk<T> {
  readonly ok: true
  readonly value: T
}

export interface ApiFail {
  readonly ok: false
  readonly error: {
    readonly code: WireErrorCode
    readonly message: string
    /** Optional stable sub-reason the browser can translate (`message` stays technical). */
    readonly reasonCode?: string
  }
}

export type ApiResult<T> = ApiOk<T> | ApiFail

export function apiOk<T>(value: T): ApiOk<T> {
  return { ok: true, value }
}

export function apiFail(code: WireErrorCode, message: string, reasonCode?: string): ApiFail {
  return { ok: false, error: reasonCode === undefined ? { code, message } : { code, message, reasonCode } }
}

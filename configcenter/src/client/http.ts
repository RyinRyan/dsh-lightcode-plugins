/**
 * Shared browser transport for the configuration center.
 *
 * Every panel API goes through the same timeout, envelope unwrapping, and
 * typed error path, so a route failure is reported identically no matter
 * which feature produced it.
 */
import type { ApiFail, WireErrorCode } from '../shared/api.js'

/** A failed panel request: a wire error code or a transport failure. */
export class ApiClientError extends Error {
  constructor(
    readonly code: WireErrorCode | 'NETWORK',
    message: string,
    readonly reasonCode?: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

export const REQUEST_TIMEOUT_MS = 12_000

/** Minimal fetch shape; narrow enough to fake in tests, wide enough for `fetch`. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: BodyInit | string; cache?: RequestCache },
) => Promise<{ status: number; json(): Promise<unknown> }>

export async function withTimeout<T>(request: Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ApiClientError('NETWORK', 'request timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Decode a wire envelope, turning every failure shape into `ApiClientError`. */
export async function unwrapJson<T>(response: { status: number; json(): Promise<unknown> }): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiClientError('NETWORK', `invalid response body (HTTP ${response.status})`)
  }
  if (body !== null && typeof body === 'object' && (body as { ok?: unknown }).ok === true) {
    return (body as { value: T }).value
  }
  const error = (body as Partial<ApiFail>).error
  throw new ApiClientError(error?.code ?? 'INTERNAL', error?.message ?? `HTTP ${response.status}`, error?.reasonCode)
}

/** Standard init for a JSON POST. */
export function jsonInit(value: unknown): { method: 'POST'; headers: Record<string, string>; body: string } {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }
}

/** Fetch with timeout; transport failures become `ApiClientError`. */
export async function fetchJson(
  doFetch: FetchLike,
  input: string,
  init?: Parameters<FetchLike>[1],
): Promise<{ status: number; json(): Promise<unknown> }> {
  try {
    return await withTimeout(doFetch(input, init))
  } catch (error) {
    if (error instanceof ApiClientError) throw error
    throw new ApiClientError('NETWORK', error instanceof Error ? error.message : String(error))
  }
}

/** Browser API client for the credential-center routes. */
import { ROUTE_PREFIX, type ApiFail, type ApiResult, type SaveVariableInput, type VariableSnapshot } from '../shared/protocol.js'

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>

export class CredentialCenterApiError extends Error {
  constructor(readonly code: ApiFail['error']['code'] | 'NETWORK', message: string) {
    super(message)
    this.name = 'CredentialCenterApiError'
  }
}

export interface CredentialCenterApi {
  list(): Promise<VariableSnapshot>
  save(input: SaveVariableInput): Promise<VariableSnapshot>
  remove(name: string): Promise<VariableSnapshot>
}

const REQUEST_TIMEOUT_MS = 12_000

async function withTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([request, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('request timed out')), REQUEST_TIMEOUT_MS) })])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

/** Create the same-origin browser API. */
export function createCredentialCenterApi(doFetch: FetchLike = (input, init) => globalThis.fetch(input, init)): CredentialCenterApi {
  async function call(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<VariableSnapshot> {
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await withTimeout(doFetch(`${ROUTE_PREFIX}${path}`, init))
    } catch (error) {
      throw new CredentialCenterApiError('NETWORK', error instanceof Error ? error.message : String(error))
    }
    let body: ApiResult<VariableSnapshot>
    try {
      body = await response.json() as ApiResult<VariableSnapshot>
    } catch {
      throw new CredentialCenterApiError('NETWORK', `invalid response body (HTTP ${response.status})`)
    }
    if (body !== null && typeof body === 'object' && 'ok' in body && body.ok === true) return body.value
    const failure = body as Partial<ApiFail>
    throw new CredentialCenterApiError(failure.error?.code ?? 'INTERNAL', failure.error?.message ?? `HTTP ${response.status}`)
  }

  const json = (value: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  return {
    list: () => call('/variables'),
    save: input => call('/variables', json(input)),
    remove: name => call('/delete', json({ name })),
  }
}

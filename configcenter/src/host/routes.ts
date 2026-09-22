/** Same-origin JSON routes used by the credential-center page. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  MAX_BODY_BYTES,
  ROUTE_PREFIX,
  type ApiResult,
  type VariableSnapshot,
  apiFail,
  apiOk,
  isVariableName,
  validateSaveInput,
} from '../shared/protocol.js'
import { HttpBodyError, readJsonBody, sameOrigin, sendJson } from './http.js'
import { VariableStoreError, type VariableStore } from './store.js'

export interface ApiRequest {
  readonly method: string
  readonly pathname: string
  readonly body: unknown
}

export interface ApiOutcome {
  readonly status: number
  readonly body: ApiResult<VariableSnapshot>
}

/** Map a parsed request onto the store. Pure so tests need no HTTP stack. */
export async function dispatchApi(store: VariableStore, request: ApiRequest): Promise<ApiOutcome> {
  const path = request.pathname.slice(ROUTE_PREFIX.length)
  try {
    if (request.method === 'GET' && (path === '' || path === '/variables')) {
      return { status: 200, body: apiOk(store.snapshot()) }
    }
    if (request.method === 'POST' && path === '/variables') {
      return { status: 200, body: apiOk(await store.save(validateSaveInput(request.body))) }
    }
    if (request.method === 'POST' && path === '/delete') {
      const name = typeof request.body === 'object' && request.body !== null
        ? (request.body as { name?: unknown }).name
        : undefined
      if (!isVariableName(name)) {
        return { status: 400, body: apiFail('VALIDATION', 'variable name must match [A-Za-z_][A-Za-z0-9_]*') }
      }
      return { status: 200, body: apiOk(await store.remove(name)) }
    }
    return { status: 404, body: apiFail('NOT_FOUND', `unknown route ${request.method} ${request.pathname}`) }
  } catch (error) {
    if (error instanceof TypeError) return { status: 400, body: apiFail('VALIDATION', error.message) }
    if (error instanceof VariableStoreError) {
      return { status: error.code === 'NOT_FOUND' ? 404 : 400, body: apiFail(error.code, error.message) }
    }
    return { status: 500, body: apiFail('INTERNAL', 'internal credential-center failure') }
  }
}

/** Structural host surface this module needs; satisfied by a Cordis context. */
export interface CredentialRouteHost {
  readonly webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  readonly logger?: { error(message: string): void }
}

/** Register the panel routes and return their disposer. */
export function registerCredentialCenterRoutes(host: CredentialRouteHost, store: VariableStore): () => void {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      // Writes and deletes must never be triggerable from another origin.
      if (!sameOrigin(req)) {
        sendJson(res, 403, apiFail('ORIGIN', 'untrusted origin'))
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const body = req.method === 'POST' ? await readJsonBody(req, MAX_BODY_BYTES) : undefined
      const outcome = await dispatchApi(store, { method: req.method ?? 'GET', pathname: url.pathname, body })
      if (outcome.status >= 500) {
        host.logger?.error(`[configcenter] credential route failed: ${req.method} ${url.pathname}`)
      }
      sendJson(res, outcome.status, outcome.body)
    } catch (error) {
      if (error instanceof HttpBodyError) {
        sendJson(res, error.status, apiFail('VALIDATION', error.message))
        return
      }
      host.logger?.error(`[configcenter] credential route crashed: ${error instanceof Error ? error.message : String(error)}`)
      sendJson(res, 500, apiFail('INTERNAL', 'internal credential-center failure'))
    }
  }
  return host.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
}

/**
 * Fail-safe routes for a store that could not load: the panel gets a
 * structured 503 explaining the outage instead of an opaque 404.
 */
export function registerUnavailableRoutes(host: CredentialRouteHost, reason: string): () => void {
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    host.logger?.error(`[configcenter] credential store unavailable: ${req.method} ${req.url ?? ''} (${reason})`)
    sendJson(res, 503, apiFail('INTERNAL', 'credential store is unavailable; see the host log for details'))
  }
  return host.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
}

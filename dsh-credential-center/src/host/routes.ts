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

/** Map a parsed request onto the store. */
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
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 400
      return { status, body: apiFail(error.code, error.message) }
    }
    return { status: 500, body: apiFail('INTERNAL', 'internal credential-center failure') }
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = chunk as Buffer
    size += bytes.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(bytes)
  }
  if (chunks.length === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  return text.trim().length === 0 ? undefined : JSON.parse(text)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/** Register the panel routes and return their disposer. */
export function registerCredentialCenterRoutes(
  ctx: { webServer: { register(route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void } },
  store: VariableStore,
): () => void {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const body = req.method === 'POST' ? await readBody(req) : undefined
      const outcome = await dispatchApi(store, { method: req.method ?? 'GET', pathname: url.pathname, body })
      sendJson(res, outcome.status, outcome.body)
    } catch {
      sendJson(res, 413, apiFail('VALIDATION', 'request body is not valid bounded JSON'))
    }
  }
  return ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
}

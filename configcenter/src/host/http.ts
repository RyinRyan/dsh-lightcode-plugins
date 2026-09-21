/**
 * Same-origin JSON plumbing shared by the credential and installer routes.
 *
 * Host routes differ only in their domain logic; body framing, size limits,
 * origin checks, and response headers live here so the two route modules
 * cannot drift apart again.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { apiFail } from '../shared/api.js'

/** A request-body framing failure with its intended HTTP status. */
export class HttpBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) {
    super(message)
    this.name = 'HttpBodyError'
  }
}

/**
 * Accept a same-origin request. Browsers always send an `origin` header on
 * cross-site POSTs, so a mismatched or missing host pairing is rejected;
 * non-browser clients that omit `origin` are allowed through.
 */
export function sameOrigin(request: Pick<IncomingMessage, 'headers'>): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read at most `maxBytes` from the request stream. */
export async function readBoundedBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpBodyError(413, 'request body is too large')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new HttpBodyError(413, 'request body is too large')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

/** Read a bounded JSON body; an empty body resolves to `undefined`. */
export async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const bytes = await readBoundedBody(request, maxBytes)
  if (bytes.length === 0) return undefined
  const text = bytes.toString('utf8')
  if (text.trim().length === 0) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new HttpBodyError(400, 'request body is not valid JSON')
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

/** Uniform failure response for body framing errors. */
export function sendBodyError(response: ServerResponse, error: HttpBodyError): void {
  sendJson(response, error.status, apiFail('VALIDATION', error.message))
}

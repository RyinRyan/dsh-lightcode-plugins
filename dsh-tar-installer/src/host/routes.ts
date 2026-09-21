import type { IncomingMessage, ServerResponse } from 'node:http'
import { ROUTE_PREFIX, apiFail, apiOk } from '../shared/protocol.js'
import type { InstallerService } from './installer.js'
import { TarballValidationError } from './tarball.js'
import { restartDisabledReason, scheduleRestart, servingPort, trustedRestartRequest } from './restart.js'

export interface WebServerHost {
  webServer: {
    register(route: { kind: 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

export function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  if (host === undefined) return false
  try { return new URL(origin).host === host } catch { return false }
}

async function readBounded(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('upload is too large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new Error('upload is too large')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  return JSON.parse((await readBounded(request, 4096)).toString('utf8')) as unknown
}

function fileNameFrom(request: IncomingMessage): string {
  const raw = request.headers['x-dsh-file-name']
  if (typeof raw !== 'string') return 'plugin.tgz'
  try { return decodeURIComponent(raw).slice(0, 240) } catch { return 'plugin.tgz' }
}

/** Mount the same-origin upload, install and status API. */
export function registerInstallerRoutes(host: WebServerHost, service: InstallerService, options: { allowRestart: boolean }): () => void {
  let restarting = false
  return host.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const suffix = url.pathname.slice(ROUTE_PREFIX.length)
      if (request.method === 'GET' && (suffix === '' || suffix === '/status')) {
        sendJson(response, 200, apiOk(service.snapshot()))
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, apiFail('METHOD', 'method not allowed'))
        return
      }
      if (suffix === '/restart') {
        const disabled = restartDisabledReason(options.allowRestart)
        if (disabled !== null) { sendJson(response, 403, apiFail('RESTART_DISABLED', disabled)); return }
        if (!trustedRestartRequest(request)) { sendJson(response, 403, apiFail('ORIGIN', 'restart is limited to same-origin loopback requests')); return }
        if (service.isRunning()) { sendJson(response, 409, apiFail('BUSY', 'cannot restart while an install is running')); return }
        if (restarting) { sendJson(response, 409, apiFail('BUSY', 'restart already scheduled')); return }
        restarting = true
        try { sendJson(response, 202, apiOk(scheduleRestart(servingPort(request)))) } catch (error) { restarting = false; throw error }
        return
      }
      if (!sameOrigin(request)) {
        sendJson(response, 403, apiFail('ORIGIN', 'untrusted origin'))
        return
      }
      try {
        if (suffix === '/inspect') {
          const limit = service.snapshot().maxUploadBytes
          const bytes = await readBounded(request, limit)
          const preview = await service.inspect(bytes, fileNameFrom(request))
          sendJson(response, 201, apiOk(preview))
          return
        }
        if (suffix === '/install') {
          const body = await readJson(request) as { token?: unknown; allowScripts?: unknown }
          if (typeof body.token !== 'string' || typeof body.allowScripts !== 'boolean') {
            sendJson(response, 400, apiFail('VALIDATION', 'token and allowScripts are required'))
            return
          }
          const operation = await service.start(body.token, body.allowScripts)
          sendJson(response, 202, apiOk(operation))
          return
        }
        sendJson(response, 404, apiFail('NOT_FOUND', 'unknown installer route'))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const validation = error instanceof TarballValidationError || /too large|missing|expired|disabled|already running/.test(message)
        sendJson(response, validation ? 400 : 500, apiFail(validation ? 'VALIDATION' : 'INTERNAL', message))
      }
    },
  })
}

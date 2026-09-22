/** Same-origin upload, install, remove, status, and restart API. */
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { ApiResult } from '../../shared/api.js'
import { ROUTE_PREFIX, apiFail, apiOk } from '../shared/protocol.js'
import { HttpBodyError, parseJsonBody, readBoundedBody, sameOrigin, sendJson } from '../../host/http.js'
import { InstallerError, type InstallerService } from './installer.js'
import { TarballValidationError } from './tarball.js'
import { type RestartDisabledReason, restartDisabledReason, scheduleRestart, servingPort, trustedRestartRequest } from './restart.js'

/** Structural host surface; satisfied by a Cordis context. */
export interface WebServerHost {
  readonly webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
  readonly logger?: { error(message: string): void }
}

/** A parsed installer request, decoupled from node HTTP so tests need no server. */
export interface InstallerHttpRequest {
  readonly method: string
  readonly pathname: string
  readonly headers: IncomingHttpHeaders
  readonly remoteAddress: string | undefined
  /** Read the raw request body, enforcing `maxBytes`. */
  readBody(maxBytes: number): Promise<Buffer>
}

export interface InstallerHttpResponse {
  readonly status: number
  readonly body: ApiResult<unknown>
}

export interface InstallerRouteOptions {
  readonly allowRestart: boolean
  /** Injectable restart action for tests; defaults to the real self-restart. */
  readonly restart?: (port: number | null) => unknown
  readonly logger?: { error(message: string): void }
}

const RESTART_DISABLED_MESSAGES: Record<RestartDisabledReason, string> = {
  'restart-disabled': 'self-service restart is disabled for this profile',
  'debugger-active': 'self-service restart is unavailable while a debugger is attached',
}

function fileNameFrom(headers: IncomingHttpHeaders): string {
  const raw = headers['x-dsh-file-name']
  if (typeof raw !== 'string') return 'plugin.tgz'
  try {
    return decodeURIComponent(raw).slice(0, 240)
  } catch {
    return 'plugin.tgz'
  }
}

/** Maps one installer request to its outcome, one operation at a time. */
export class InstallerRouter {
  #restarting = false

  constructor(
    private readonly service: InstallerService,
    private readonly options: InstallerRouteOptions,
  ) {}

  async handle(request: InstallerHttpRequest): Promise<InstallerHttpResponse> {
    const suffix = request.pathname.slice(ROUTE_PREFIX.length)
    if (request.method === 'GET' && (suffix === '' || suffix === '/status')) {
      return { status: 200, body: apiOk(this.service.snapshot()) }
    }
    if (request.method !== 'POST') {
      return { status: 405, body: apiFail('METHOD', 'method not allowed') }
    }
    try {
      if (suffix === '/restart') return this.#restart(request)
      if (!sameOrigin({ headers: request.headers })) {
        return { status: 403, body: apiFail('ORIGIN', 'untrusted origin') }
      }
      if (suffix === '/inspect') return await this.#inspect(request)
      if (suffix === '/install') return await this.#install(request)
      if (suffix === '/remove') return await this.#remove(request)
      return { status: 404, body: apiFail('NOT_FOUND', 'unknown installer route') }
    } catch (error) {
      return this.#failure(error)
    }
  }

  #restart(request: InstallerHttpRequest): InstallerHttpResponse {
    const disabled = restartDisabledReason(this.options.allowRestart)
    if (disabled !== null) {
      return { status: 403, body: apiFail('RESTART_DISABLED', RESTART_DISABLED_MESSAGES[disabled], disabled) }
    }
    if (!trustedRestartRequest(request)) {
      return { status: 403, body: apiFail('ORIGIN', 'restart is limited to same-origin loopback requests') }
    }
    if (this.service.isRunning()) {
      return { status: 409, body: apiFail('BUSY', 'cannot restart while an operation is running') }
    }
    if (this.#restarting) {
      return { status: 409, body: apiFail('BUSY', 'restart already scheduled') }
    }
    this.#restarting = true
    try {
      const restart = this.options.restart ?? scheduleRestart
      return { status: 202, body: apiOk(restart(servingPort(request))) }
    } catch (error) {
      this.#restarting = false
      throw error
    }
  }

  async #inspect(request: InstallerHttpRequest): Promise<InstallerHttpResponse> {
    const limit = this.service.snapshot().maxUploadBytes
    const bytes = await request.readBody(limit)
    const preview = await this.service.inspect(bytes, fileNameFrom(request.headers))
    return { status: 201, body: apiOk(preview) }
  }

  async #install(request: InstallerHttpRequest): Promise<InstallerHttpResponse> {
    const parsed: unknown = parseJsonBody(await request.readBody(4096))
    const body = typeof parsed === 'object' && parsed !== null ? parsed as { token?: unknown; allowScripts?: unknown } : null
    if (body === null || typeof body.token !== 'string' || typeof body.allowScripts !== 'boolean') {
      return { status: 400, body: apiFail('VALIDATION', 'token and allowScripts are required') }
    }
    const operation = await this.service.start(body.token, body.allowScripts)
    return { status: 202, body: apiOk(operation) }
  }

  async #remove(request: InstallerHttpRequest): Promise<InstallerHttpResponse> {
    const parsed: unknown = parseJsonBody(await request.readBody(4096))
    const name = typeof parsed === 'object' && parsed !== null ? (parsed as { name?: unknown }).name : undefined
    if (typeof name !== 'string') {
      return { status: 400, body: apiFail('VALIDATION', 'name is required') }
    }
    const operation = await this.service.remove(name)
    return { status: 202, body: apiOk(operation) }
  }

  #failure(error: unknown): InstallerHttpResponse {
    if (error instanceof InstallerError) {
      const status = error.code === 'BUSY' ? 409 : 400
      return { status, body: apiFail(error.code, error.message) }
    }
    if (error instanceof TarballValidationError) {
      return { status: 400, body: apiFail('VALIDATION', error.message) }
    }
    if (error instanceof HttpBodyError) {
      return { status: error.status, body: apiFail('VALIDATION', error.message) }
    }
    // Internal failures are logged host-side and reported without detail.
    this.options.logger?.error(`[configcenter] installer route failed: ${error instanceof Error ? error.message : String(error)}`)
    return { status: 500, body: apiFail('INTERNAL', 'internal installer failure') }
  }
}

/** Mount the same-origin upload, install, remove, status, and restart API. */
export function registerInstallerRoutes(host: WebServerHost, service: InstallerService, options: InstallerRouteOptions): () => void {
  const router = new InstallerRouter(service, { logger: host.logger, ...options })
  return host.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const outcome = await router.handle({
          method: request.method ?? 'GET',
          pathname: url.pathname,
          headers: request.headers,
          remoteAddress: request.socket.remoteAddress,
          readBody: maxBytes => readBoundedBody(request, maxBytes),
        })
        sendJson(response, outcome.status, outcome.body)
      } catch (error) {
        host.logger?.error(`[configcenter] installer route crashed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(response, 500, apiFail('INTERNAL', 'internal installer failure'))
      }
    },
  })
}

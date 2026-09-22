import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dispatchApi, registerCredentialCenterRoutes, registerUnavailableRoutes } from '../src/host/routes.js'
import { VariableStore } from '../src/host/store.js'

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/** Capture the handler a route module registers, without an HTTP server. */
function captureHandler(): { host: { webServer: { register(route: { handler: RouteHandler }): () => void } }; handler: () => RouteHandler | undefined } {
  let handler: RouteHandler | undefined
  const host = {
    webServer: {
      register(route: { handler: RouteHandler }): () => void {
        handler = route.handler
        return () => {}
      },
    },
  }
  return { host, handler: () => handler }
}

function fakeRequest(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, url, headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage
}

function fakeResponse(): { res: ServerResponse; state: { status: number; body: unknown } } {
  const state = { status: 0, body: undefined as unknown }
  const res = {
    writeHead(status: number): void {
      state.status = status
    },
    end(chunk?: string): void {
      if (chunk !== undefined) state.body = JSON.parse(chunk)
    },
  } as unknown as ServerResponse
  return { res, state }
}

test('route dispatcher manages rows without returning values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credential-routes-'))
  const store = new VariableStore({ dataDir: dir })
  await store.load()
  try {
    const created = await dispatchApi(store, { method: 'POST', pathname: '/dsh-credential-center/variables', body: { name: 'TOKEN', description: 'test', value: 'secret' } })
    assert.equal(created.status, 200)
    assert.equal(JSON.stringify(created.body).includes('secret'), false)
    const listed = await dispatchApi(store, { method: 'GET', pathname: '/dsh-credential-center/variables', body: undefined })
    assert.equal(listed.status, 200)
    const removed = await dispatchApi(store, { method: 'POST', pathname: '/dsh-credential-center/delete', body: { name: 'TOKEN' } })
    assert.equal(removed.status, 200)
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('route dispatcher rejects malformed names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credential-routes-'))
  const store = new VariableStore({ dataDir: dir })
  await store.load()
  try {
    const outcome = await dispatchApi(store, { method: 'POST', pathname: '/dsh-credential-center/variables', body: { name: 'BAD-NAME', description: '', value: 'x' } })
    assert.equal(outcome.status, 400)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('registered routes reject cross-origin requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credential-routes-'))
  const store = new VariableStore({ dataDir: dir })
  await store.load()
  try {
    const { host, handler } = captureHandler()
    registerCredentialCenterRoutes(host, store)
    const { res, state } = fakeResponse()
    await handler()?.(fakeRequest('POST', '/dsh-credential-center/variables', { origin: 'http://evil.example', host: 'localhost:3080' }), res)
    assert.equal(state.status, 403)
    assert.deepEqual(state.body, { ok: false, error: { code: 'ORIGIN', message: 'untrusted origin' } })
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('registered routes serve same-origin reads and writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credential-routes-'))
  const store = new VariableStore({ dataDir: dir })
  await store.load()
  try {
    const { host, handler } = captureHandler()
    registerCredentialCenterRoutes(host, store)
    const { res, state } = fakeResponse()
    await handler()?.(fakeRequest('GET', '/dsh-credential-center/variables'), res)
    assert.equal(state.status, 200)
    assert.equal((state.body as { ok: boolean }).ok, true)
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('unavailable routes report a structured 503', async () => {
  const { host, handler } = captureHandler()
  registerUnavailableRoutes(host, 'unsupported document version 2')
  const { res, state } = fakeResponse()
  await handler()?.(fakeRequest('GET', '/dsh-credential-center/variables'), res)
  assert.equal(state.status, 503)
  const body = state.body as { ok: boolean; error: { code: string } }
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'INTERNAL')
})

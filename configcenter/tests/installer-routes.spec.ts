import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { InstallerRouter, type InstallerHttpRequest } from '../src/tar-installer/host/routes.js'
import { InstallerService } from '../src/tar-installer/host/installer.js'
import { StagingStore } from '../src/tar-installer/host/staging.js'
import { ROUTE_PREFIX } from '../src/tar-installer/shared/protocol.js'
import { demoTarball } from './helpers/tar.js'

function request(method: string, pathname: string, overrides: Partial<InstallerHttpRequest> = {}): InstallerHttpRequest {
  return {
    headers: {},
    remoteAddress: '127.0.0.1',
    readBody: async () => Buffer.alloc(0),
    ...overrides,
    method,
    pathname,
  }
}

function jsonRequest(method: string, pathname: string, body: unknown): InstallerHttpRequest {
  const bytes = Buffer.from(body === undefined ? '' : JSON.stringify(body), 'utf8')
  return request(method, pathname, { readBody: async () => bytes })
}

async function createRouter(options: { allowRestart?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-router-'))
  const service = new InstallerService({
    profile: 'test-profile',
    profileDirectory: dir,
    allowInstallScripts: false,
    maxUploadBytes: 1024 * 1024,
    staging: new StagingStore(join(dir, 'staging')),
    run: async () => ({ exitCode: 0, timedOut: false, output: '' }),
    readInstalled: () => [],
  })
  const restarts: Array<number | null> = []
  const router = new InstallerRouter(service, {
    allowRestart: options.allowRestart ?? true,
    restart: (port: number | null) => {
      restarts.push(port)
      return { pid: 1, logFile: 'restart.log' }
    },
  })
  return { router, service, restarts, dir }
}

test('serves the status snapshot', async () => {
  const { router, service, dir } = await createRouter()
  try {
    const outcome = await router.handle(request('GET', `${ROUTE_PREFIX}/status`))
    assert.equal(outcome.status, 200)
    const body = outcome.body as { ok: boolean; value: { profile: string } }
    assert.equal(body.ok, true)
    assert.equal(body.value.profile, 'test-profile')
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('rejects unknown routes and methods', async () => {
  const { router, service, dir } = await createRouter()
  try {
    assert.equal((await router.handle(request('POST', `${ROUTE_PREFIX}/nope`))).status, 404)
    assert.equal((await router.handle(request('PUT', `${ROUTE_PREFIX}/status`))).status, 405)
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('rejects cross-origin mutations', async () => {
  const { router, service, dir } = await createRouter()
  try {
    const outcome = await router.handle(request('POST', `${ROUTE_PREFIX}/install`, {
      headers: { origin: 'http://evil.example', host: 'localhost:3080' },
    }))
    assert.equal(outcome.status, 403)
    assert.equal((outcome.body as { error: { code: string } }).error.code, 'ORIGIN')
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('restart serves loopback same-origin requests with the serving port', async () => {
  const { router, restarts, service, dir } = await createRouter()
  try {
    const outcome = await router.handle(request('POST', `${ROUTE_PREFIX}/restart`, {
      headers: { origin: 'http://localhost:3080', host: 'localhost:3080' },
    }))
    assert.equal(outcome.status, 202)
    assert.deepEqual(restarts, [3080])
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('restart refuses forwarded or non-loopback requests', async () => {
  const { router, restarts, service, dir } = await createRouter()
  try {
    const forwarded = await router.handle(request('POST', `${ROUTE_PREFIX}/restart`, {
      headers: { origin: 'http://localhost:3080', host: 'localhost:3080', 'x-forwarded-for': '1.2.3.4' },
    }))
    assert.equal(forwarded.status, 403)
    const remote = await router.handle(request('POST', `${ROUTE_PREFIX}/restart`, {
      headers: { origin: 'http://localhost:3080', host: 'localhost:3080' },
      remoteAddress: '203.0.113.9',
    }))
    assert.equal(remote.status, 403)
    assert.deepEqual(restarts, [])
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('restart can be disabled by configuration with a stable reason', async () => {
  const { router, service, dir } = await createRouter({ allowRestart: false })
  try {
    const outcome = await router.handle(request('POST', `${ROUTE_PREFIX}/restart`, {
      headers: { origin: 'http://localhost:3080', host: 'localhost:3080' },
    }))
    assert.equal(outcome.status, 403)
    const body = outcome.body as { ok: false; error: { code: string; reasonCode?: string } }
    assert.equal(body.error.code, 'RESTART_DISABLED')
    assert.equal(body.error.reasonCode, 'restart-disabled')
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('inspects a valid upload and installs it', async () => {
  const { router, service, dir } = await createRouter()
  try {
    const bytes = demoTarball()
    const inspect = await router.handle(request('POST', `${ROUTE_PREFIX}/inspect`, {
      headers: { 'x-dsh-file-name': 'demo.tgz' },
      readBody: async () => bytes,
    }))
    assert.equal(inspect.status, 201)
    const preview = (inspect.body as { value: { token: string; name: string } }).value
    assert.equal(preview.name, 'demo-plugin')

    const install = await router.handle(jsonRequest('POST', `${ROUTE_PREFIX}/install`, { token: preview.token, allowScripts: false }))
    assert.equal(install.status, 202)
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('validates install and remove bodies', async () => {
  const { router, service, dir } = await createRouter()
  try {
    assert.equal((await router.handle(jsonRequest('POST', `${ROUTE_PREFIX}/install`, { token: 'nope' }))).status, 400)
    assert.equal((await router.handle(jsonRequest('POST', `${ROUTE_PREFIX}/remove`, {}))).status, 400)
    assert.equal((await router.handle(request('POST', `${ROUTE_PREFIX}/install`, { readBody: async () => Buffer.from('{invalid json') }))).status, 400)
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

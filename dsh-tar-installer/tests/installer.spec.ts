import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PackagePreview } from '../src/shared/protocol.js'
import { InstallerService } from '../src/host/installer.js'

const preview: PackagePreview = {
  token: 'token', fileName: 'demo.tgz', name: 'demo', version: '1.0.0', size: 10,
  sha256: 'a'.repeat(64), hasHost: true, hasClient: true, hasBundlePatch: true,
}

class FakeStaging {
  peek() { return preview }
  async stage() { return preview }
  async consume(token: string) { return token === 'token' ? { path: 'C:\\temp\\token.tgz', preview } : null }
  async removePath() {}
  async dispose() {}
}

async function settle(service: InstallerService): Promise<void> {
  for (let index = 0; index < 20 && service.snapshot().operation?.state === 'running'; index++) await new Promise(resolve => setTimeout(resolve, 0))
}

test('starts one detached install operation and records success', async () => {
  const calls: unknown[] = []
  const service = new InstallerService({ profile: 'web', allowInstallScripts: false, maxUploadBytes: 1024, staging: new FakeStaging() as never, persist: async () => 'C:\\profile\\tarballs\\demo.tgz', run: async (...args) => { calls.push(args); return { exitCode: 0, timedOut: false, output: 'done' } } })
  const operation = await service.start('token', false)
  assert.equal(operation.state, 'running')
  await settle(service)
  assert.deepEqual(calls, [['web', 'C:\\profile\\tarballs\\demo.tgz', false]])
  assert.equal(service.snapshot().operation?.state, 'succeeded')
})

test('does not allow scripts unless configured', async () => {
  const service = new InstallerService({ profile: 'web', allowInstallScripts: false, maxUploadBytes: 1024, staging: new FakeStaging() as never, run: async () => ({ exitCode: 0, timedOut: false, output: '' }) })
  await assert.rejects(service.start('token', true), /disabled/)
})

test('serializes installs while an operation is running', async () => {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const service = new InstallerService({ profile: 'web', allowInstallScripts: false, maxUploadBytes: 1024, staging: new FakeStaging() as never, run: async () => { await wait; return { exitCode: 0, timedOut: false, output: '' } } })
  await service.start('token', false)
  await assert.rejects(service.start('token', false), /already running/)
  release()
  await settle(service)
})

test('includes a fresh installed-package snapshot', () => {
  let calls = 0
  const service = new InstallerService({ profile: 'web', allowInstallScripts: false, maxUploadBytes: 1024, staging: new FakeStaging() as never, readInstalled: () => [{ name: `package-${++calls}`, version: '1.0.0', source: 'registry', isDshPlugin: false }] })
  assert.equal(service.snapshot().packages[0]?.name, 'package-1')
  assert.equal(service.snapshot().packages[0]?.name, 'package-2')
})

test('does not invoke DSH when persistent artifact storage fails', async () => {
  let invoked = false
  const service = new InstallerService({ profile: 'web', allowInstallScripts: false, maxUploadBytes: 1024, staging: new FakeStaging() as never, persist: async () => { throw new Error('artifact storage failed') }, run: async () => { invoked = true; return { exitCode: 0, timedOut: false, output: '' } } })
  await service.start('token', false)
  await settle(service)
  assert.equal(invoked, false)
  assert.match(service.snapshot().operation?.error ?? '', /artifact storage failed/)
})

test('records live activation after a successful installation', async () => {
  const service = new InstallerService({ profile: 'web', allowInstallScripts: false, maxUploadBytes: 1024, staging: new FakeStaging() as never, persist: async () => 'C:\\profile\\tarballs\\demo.tgz', run: async () => ({ exitCode: 0, timedOut: false, output: '' }), activate: async name => ({ state: 'live', reason: name }) })
  await service.start('token', false)
  await settle(service)
  assert.deepEqual(service.snapshot().operation?.activation, { state: 'live', reason: 'demo' })
})

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { InstallerError, InstallerService, type CommandResult, type InstallerServiceOptions } from '../src/tar-installer/host/installer.js'
import { StagingStore } from '../src/tar-installer/host/staging.js'
import { demoTarball } from './helpers/tar.js'

const OK: CommandResult = { exitCode: 0, timedOut: false, output: 'done' }
const FAIL: CommandResult = { exitCode: 1, timedOut: false, output: 'boom' }

async function createHarness(overrides: Partial<InstallerServiceOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-installer-'))
  const events: string[] = []
  const runs: Array<{ profile: string; path: string; allowScripts: boolean }> = []
  const service = new InstallerService({
    profile: 'test-profile',
    profileDirectory: dir,
    allowInstallScripts: false,
    maxUploadBytes: 1024 * 1024,
    staging: new StagingStore(join(dir, 'staging')),
    run: async (profile, path, allowScripts) => {
      runs.push({ profile, path, allowScripts })
      return OK
    },
    remove: async () => OK,
    readInstalled: () => [{ name: 'demo-plugin', version: '1.2.3', source: 'registry', isDshPlugin: true }],
    persist: async path => path,
    activate: async name => {
      events.push(`activate:${name}`)
      return { state: 'live' }
    },
    deactivate: async name => {
      events.push(`deactivate:${name}`)
      return { state: 'live' }
    },
    audit: event => { events.push(event) },
    ...overrides,
  })
  return { service, events, runs, dir }
}

async function settle(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
    await new Promise(resolveWait => { setTimeout(resolveWait, 5) })
  }
}

test('installs a staged tarball and reports the live activation', async () => {
  const { service, events, runs, dir } = await createHarness()
  try {
    const preview = await service.inspect(demoTarball(), 'demo.tgz')
    const operation = await service.start(preview.token, false)
    assert.equal(operation.state, 'running')
    assert.equal(operation.kind, 'install')
    await settle(() => service.snapshot().operation?.state === 'succeeded')
    const finished = service.snapshot().operation
    assert.equal(finished?.state, 'succeeded')
    assert.equal(finished?.activation?.state, 'live')
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.profile, 'test-profile')
    assert.equal(runs[0]?.allowScripts, false)
    assert.ok(events.includes('plugin.install.started'))
    assert.ok(events.includes('plugin.install.finished'))
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('records a failed install with the CLI exit code', async () => {
  const { service, dir } = await createHarness({ run: async () => FAIL })
  try {
    const preview = await service.inspect(demoTarball(), 'demo.tgz')
    await service.start(preview.token, false)
    await settle(() => service.snapshot().operation?.state === 'failed')
    const finished = service.snapshot().operation
    assert.equal(finished?.state, 'failed')
    assert.match(finished?.error ?? '', /exited with 1/)
    assert.equal(finished?.exitCode, 1)
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('rejects concurrent operations while one is running, then recovers', async () => {
  const { service, dir } = await createHarness({ run: () => new Promise(resolveResult => { setTimeout(() => resolveResult(OK), 30) }) })
  try {
    const first = await service.inspect(demoTarball(), 'demo.tgz')
    await service.start(first.token, false)
    const busy = (error: unknown): boolean => error instanceof InstallerError && error.code === 'BUSY'
    await assert.rejects(service.inspect(demoTarball(), 'demo2.tgz'), busy)
    await assert.rejects(service.remove('demo-plugin'), busy)
    await settle(() => service.snapshot().operation?.state === 'succeeded')
    assert.equal(service.snapshot().operation?.state, 'succeeded')
    // The single-writer lock is released once the operation settles.
    const again = await service.inspect(demoTarball(), 'demo3.tgz')
    assert.equal(again.name, 'demo-plugin')
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('refuses install scripts unless the profile allows them', async () => {
  const { service, dir } = await createHarness()
  try {
    const preview = await service.inspect(demoTarball(), 'demo.tgz')
    await assert.rejects(service.start(preview.token, true), /install scripts are disabled/)
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('removes a direct dependency and deactivates it', async () => {
  const { service, events, dir } = await createHarness()
  try {
    const operation = await service.remove('demo-plugin')
    assert.equal(operation.kind, 'remove')
    await settle(() => service.snapshot().operation?.state === 'succeeded')
    assert.equal(service.snapshot().operation?.state, 'succeeded')
    assert.ok(events.includes('deactivate:demo-plugin'))
    assert.ok(events.includes('plugin.remove.finished'))
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('refuses to remove itself or unknown packages', async () => {
  const { service, dir } = await createHarness()
  try {
    await assert.rejects(service.remove('configcenter'), (error: unknown) => error instanceof InstallerError && error.code === 'VALIDATION')
    await assert.rejects(service.remove('not-installed'), /not a direct dependency/)
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('refuses to start with an unknown or expired token', async () => {
  const { service, dir } = await createHarness()
  try {
    await assert.rejects(service.start('missing-token', false), /missing or expired/)
  } finally {
    await service.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

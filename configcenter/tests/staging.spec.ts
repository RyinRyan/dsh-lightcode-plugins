import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { StagingStore } from '../src/tar-installer/host/staging.js'
import { demoTarball, pluginManifest } from './helpers/tar.js'

test('stages, consumes, and single-uses a tarball', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-staging-'))
  const store = new StagingStore(dir)
  try {
    const preview = await store.stage(demoTarball(), 'demo.tgz')
    assert.equal(preview.name, 'demo-plugin')
    const staged = await store.consume(preview.token)
    assert.notEqual(staged, null)
    assert.equal(staged?.preview.sha256, preview.sha256)
    assert.equal(await store.consume(preview.token), null)
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('expired tokens are cleaned up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-staging-'))
  const store = new StagingStore(dir, 1)
  try {
    const preview = await store.stage(demoTarball(), 'demo.tgz')
    await new Promise(resolveWait => { setTimeout(resolveWait, 10) })
    assert.equal(await store.consume(preview.token), null)
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('rejects a staged tarball that changed on disk after inspection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-staging-'))
  const store = new StagingStore(dir)
  try {
    const preview = await store.stage(demoTarball(), 'demo.tgz')
    await writeFile(join(dir, `${preview.token}.tgz`), demoTarball(pluginManifest({ version: '9.9.9' })))
    await assert.rejects(store.consume(preview.token), /changed after inspection/)
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

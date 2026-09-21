import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { dispatchApi } from '../src/host/routes.js'
import { VariableStore } from '../src/host/store.js'

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

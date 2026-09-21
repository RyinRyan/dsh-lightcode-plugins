import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { VariableStore, VariableStoreError } from '../src/host/store.js'

async function withStore(run: (store: VariableStore, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credential-center-'))
  const store = new VariableStore({ dataDir: dir, now: () => Date.parse('2026-09-21T01:00:00.000Z') })
  await store.load()
  try { await run(store, dir) } finally { await store.dispose(); await rm(dir, { recursive: true, force: true }) }
}

test('creates, updates, resolves, and removes variables', async () => {
  await withStore(async store => {
    await store.save({ name: 'DEEPSEEK_API_KEY', description: 'model', value: 'first' })
    assert.equal(store.get('DEEPSEEK_API_KEY'), 'first')
    assert.equal(store.require('DEEPSEEK_API_KEY'), 'first')
    await store.save({ name: 'DEEPSEEK_API_KEY', description: 'updated' })
    assert.equal(store.get('DEEPSEEK_API_KEY'), 'first')
    assert.equal(store.snapshot().variables[0]?.description, 'updated')
    await store.remove('DEEPSEEK_API_KEY')
    assert.equal(store.get('DEEPSEEK_API_KEY'), undefined)
    assert.throws(() => store.require('DEEPSEEK_API_KEY'), VariableStoreError)
  })
})

test('persists values but never includes them in a snapshot', async () => {
  await withStore(async (store, dir) => {
    await store.save({ name: 'TOKEN', description: 'publish', value: 'top-secret' })
    const snapshotText = JSON.stringify(store.snapshot())
    assert.equal(snapshotText.includes('top-secret'), false)
    const disk = await readFile(join(dir, 'variables.json'), 'utf8')
    assert.equal(disk.includes('top-secret'), true)
    const reopened = new VariableStore({ dataDir: dir })
    await reopened.load()
    assert.equal(reopened.require('TOKEN'), 'top-secret')
    await reopened.dispose()
  })
})

test('requires a value for a new variable', async () => {
  await withStore(async store => {
    await assert.rejects(store.save({ name: 'TOKEN', description: '' }), /value is required/)
  })
})

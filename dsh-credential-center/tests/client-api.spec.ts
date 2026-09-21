import assert from 'node:assert/strict'
import test from 'node:test'
import { CredentialCenterApiError, createCredentialCenterApi } from '../src/client/api.js'

test('client API sends save input and reads the safe snapshot', async () => {
  const calls: Array<{ input: string; body?: string }> = []
  const api = createCredentialCenterApi(async (input, init) => {
    calls.push({ input, body: init?.body })
    return { status: 200, json: async () => ({ ok: true, value: { revision: 1, variables: [] } }) }
  })
  assert.deepEqual(await api.save({ name: 'TOKEN', description: '', value: 'secret' }), { revision: 1, variables: [] })
  assert.equal(calls[0]?.input, '/dsh-credential-center/variables')
  assert.equal(JSON.parse(calls[0]?.body ?? '{}').name, 'TOKEN')
})

test('client API maps transport failures', async () => {
  const api = createCredentialCenterApi(async () => { throw new Error('offline') })
  await assert.rejects(api.list(), (error: unknown) => error instanceof CredentialCenterApiError && error.code === 'NETWORK')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createCredentialCenterApi } from '../src/client/api.js'
import { ApiClientError } from '../src/client/http.js'

test('client API sends save input and reads the safe snapshot', async () => {
  const calls: Array<{ input: string; body?: string }> = []
  const api = createCredentialCenterApi(async (input, init) => {
    calls.push({ input, body: typeof init?.body === 'string' ? init.body : undefined })
    return { status: 200, json: async () => ({ ok: true, value: { revision: 1, variables: [] } }) }
  })
  assert.deepEqual(await api.save({ name: 'TOKEN', description: '', value: 'secret' }), { revision: 1, variables: [] })
  assert.equal(calls[0]?.input, '/dsh-credential-center/variables')
  assert.equal(JSON.parse(calls[0]?.body ?? '{}').name, 'TOKEN')
})

test('client API maps transport failures', async () => {
  const api = createCredentialCenterApi(async () => { throw new Error('offline') })
  await assert.rejects(api.list(), (error: unknown) => error instanceof ApiClientError && error.code === 'NETWORK')
})

test('client API surfaces wire failures with their code', async () => {
  const api = createCredentialCenterApi(async () => ({
    status: 403,
    json: async () => ({ ok: false, error: { code: 'ORIGIN', message: 'untrusted origin', reasonCode: 'restart-disabled' } }),
  }))
  await assert.rejects(api.list(), (error: unknown) => error instanceof ApiClientError && error.code === 'ORIGIN' && error.reasonCode === 'restart-disabled')
})

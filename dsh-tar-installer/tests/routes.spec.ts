import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sameOrigin } from '../src/host/routes.js'

test('sameOrigin accepts same host and rejects cross-site requests', () => {
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } } as never), true)
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:3000', origin: 'https://evil.example' } } as never), false)
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:3000' } } as never), true)
})

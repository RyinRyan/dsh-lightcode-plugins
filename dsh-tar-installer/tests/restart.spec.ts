import assert from 'node:assert/strict'
import { test } from 'node:test'
import { servingPort, trustedRestartRequest } from '../src/host/restart.js'

function request(overrides: object = {}) {
  return { headers: { host: '127.0.0.1:3898', origin: 'http://127.0.0.1:3898' }, socket: { remoteAddress: '127.0.0.1' }, ...overrides } as never
}

test('accepts only same-origin loopback restart requests', () => {
  assert.equal(trustedRestartRequest(request()), true)
  assert.equal(trustedRestartRequest(request({ headers: { host: '127.0.0.1:3898', origin: 'https://evil.example' } })), false)
  assert.equal(trustedRestartRequest(request({ socket: { remoteAddress: '10.0.0.8' } })), false)
  assert.equal(trustedRestartRequest(request({ headers: { host: '127.0.0.1:3898', origin: 'http://127.0.0.1:3898', forwarded: 'for=evil' } })), false)
})

test('takes the serving port from the reached host header', () => {
  assert.equal(servingPort(request()), 3898)
  assert.equal(servingPort(request({ headers: { host: 'localhost' } })), null)
  assert.equal(servingPort(request({ headers: { host: 'localhost:70000' } })), null)
})

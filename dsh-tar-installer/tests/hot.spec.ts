import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseHotPatch } from '../src/host/hot.js'

test('accepts plain insert rows for live mounting', () => {
  assert.deepEqual(parseHotPatch("- insert:\n    - id: demo\n      name: '@demo/plugin'\n"), [{ id: 'demo', name: '@demo/plugin' }])
})

test('refuses configuration-bearing patches rather than dropping configuration', () => {
  assert.equal(parseHotPatch('- insert:\n    - id: demo\n      name: demo\n      config:\n        value: 1\n'), null)
})

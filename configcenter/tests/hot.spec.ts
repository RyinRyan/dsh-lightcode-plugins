import assert from 'node:assert/strict'
import test from 'node:test'
import { parseHotPatch } from '../src/tar-installer/host/hot.js'

test('parses a plain insert patch', () => {
  assert.deepEqual(parseHotPatch('- insert:\n    - id: demo\n      name: demo\n'), [{ id: 'demo', name: 'demo' }])
})

test('parses multiple rows and quoted names', () => {
  const patch = '- insert:\n    - id: one\n      name: "one-pkg"\n    - id: two\n      name: two\n'
  assert.deepEqual(parseHotPatch(patch), [{ id: 'one', name: 'one-pkg' }, { id: 'two', name: 'two' }])
})

test('ignores comments and blank lines', () => {
  const patch = '# bundle patch\n\n- insert:\n    - id: demo # trailing note\n      name: demo\n'
  assert.deepEqual(parseHotPatch(patch), [{ id: 'demo', name: 'demo' }])
})

test('rejects patches carrying config or unsupported keys', () => {
  assert.equal(parseHotPatch('- insert:\n    - id: demo\n      name: demo\n      config:\n        a: 1\n'), null)
  assert.equal(parseHotPatch('- insert:\n    - id: demo\n      name: demo\n    - remove:\n      - other\n'), null)
})

test('rejects empty or incomplete patches', () => {
  assert.equal(parseHotPatch(''), null)
  assert.equal(parseHotPatch('# just a comment\n'), null)
  assert.equal(parseHotPatch('- insert:\n    - id: dangling\n'), null)
})

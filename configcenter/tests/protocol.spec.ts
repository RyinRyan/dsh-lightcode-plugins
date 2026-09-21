import assert from 'node:assert/strict'
import test from 'node:test'
import { isVariableName, validateSaveInput } from '../src/shared/protocol.js'

test('accepts environment-style variable names', () => {
  assert.equal(isVariableName('DEEPSEEK_API_KEY'), true)
  assert.equal(isVariableName('_PRIVATE_2'), true)
  assert.equal(isVariableName('2BAD'), false)
  assert.equal(isVariableName('BAD-NAME'), false)
})

test('validates and normalizes save input', () => {
  assert.deepEqual(validateSaveInput({ name: 'TOKEN', description: '  publish  ', value: 'secret' }), {
    name: 'TOKEN', description: 'publish', value: 'secret',
  })
  assert.deepEqual(validateSaveInput({ name: 'TOKEN', description: '' }), { name: 'TOKEN', description: '' })
  assert.throws(() => validateSaveInput({ name: 'bad-name', description: '', value: 'x' }), /variable name/)
  assert.throws(() => validateSaveInput({ name: 'TOKEN', description: '', value: '' }), /non-empty/)
})

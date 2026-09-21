import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.js'

test('publishes the live credentialVariables service to a consuming plugin context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credential-service-'))
  const ctx = new Context()
  ctx.provide('webServer', { register: () => () => {} } as never)
  apply(ctx, { dataDir: dir })
  try {
    for (let attempt = 0; attempt < 20 && ctx.get('credentialVariables') === undefined; attempt += 1) {
      await new Promise<void>(resolveWait => { setImmediate(resolveWait) })
    }
    const variables = ctx.get('credentialVariables')
    assert.ok(variables !== undefined)
    assert.equal(variables.get('TOKEN'), undefined)
  } finally {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

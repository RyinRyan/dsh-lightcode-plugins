import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { inspectTarball, TarballValidationError } from '../src/host/tarball.js'

function octal(value: number, length: number): Buffer {
  return Buffer.from(value.toString(8).padStart(length - 1, '0') + '\0', 'ascii')
}

function entry(path: string, body: Buffer, type = '0'): Buffer {
  const header = Buffer.alloc(512)
  header.write(path, 0, 100, 'utf8')
  octal(0o644, 8).copy(header, 100)
  octal(body.length, 12).copy(header, 124)
  header.write(type, 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)])
}

function tar(entries: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]))
}

test('inspects an npm-style DSH tarball', () => {
  const manifest = Buffer.from(JSON.stringify({ name: '@demo/clock', version: '1.2.3', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }))
  const result = inspectTarball(tar([entry('package/package.json', manifest)]), 'clock.tgz')
  assert.equal(result.name, '@demo/clock')
  assert.equal(result.version, '1.2.3')
  assert.equal(result.hasHost, true)
  assert.equal(result.hasClient, true)
  assert.equal(result.hasBundlePatch, true)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
})

test('rejects traversal paths before installation', () => {
  assert.throws(() => inspectTarball(tar([entry('package/../outside', Buffer.from('x'))]), 'bad.tgz'), TarballValidationError)
})

test('rejects archive links', () => {
  assert.throws(() => inspectTarball(tar([entry('package/link', Buffer.alloc(0), '2')]), 'bad.tgz'), /links are not allowed/)
})

test('rejects PAX path overrides that this narrow reader does not interpret', () => {
  assert.throws(() => inspectTarball(tar([entry('PaxHeader', Buffer.from('path=../outside'), 'x')]), 'bad.tgz'), /unsupported tar entry type/)
})

test('requires a DSH manifest declaration', () => {
  const manifest = Buffer.from(JSON.stringify({ name: 'ordinary-package', version: '1.0.0', main: 'index.js' }))
  assert.throws(() => inspectTarball(tar([entry('package/package.json', manifest)]), 'ordinary.tgz'), /does not declare/)
})

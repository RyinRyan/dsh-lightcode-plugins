import assert from 'node:assert/strict'
import test from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import { inspectTarball, TarballValidationError } from '../src/tar-installer/host/tarball.js'
import { demoTarball, gzipTarball, pluginManifest, tarEntry } from './helpers/tar.js'

test('inspects a well-formed npm-style tarball', () => {
  const preview = inspectTarball(demoTarball(), 'demo.tgz')
  assert.equal(preview.name, 'demo-plugin')
  assert.equal(preview.version, '1.2.3')
  assert.equal(preview.fileName, 'demo.tgz')
  assert.equal(preview.description, 'a demo plugin')
  assert.equal(preview.hasHost, true)
  assert.equal(preview.hasClient, true)
  assert.equal(preview.hasBundlePatch, true)
  assert.equal(preview.sha256.length, 64)
})

test('accepts a client-only package', () => {
  const manifest = JSON.stringify({ name: 'client-only', version: '0.0.1', dsh: { client: { platform: 'web' } } })
  const preview = inspectTarball(demoTarball(manifest), 'c.tgz')
  assert.equal(preview.hasClient, true)
  assert.equal(preview.hasHost, false)
})

test('rejects non-gzip input and gzip content that is not a tar archive', () => {
  assert.throws(() => inspectTarball(Buffer.from('not gzip at all'), 'x.tgz'), TarballValidationError)
  assert.throws(() => inspectTarball(gzipSync(Buffer.from('just some plain text payload')), 'x.tgz'), TarballValidationError)
})

test('rejects decompression beyond the expansion budget', () => {
  assert.throws(() => inspectTarball(demoTarball(), 'demo.tgz', 64), TarballValidationError)
})

test('rejects path traversal and absolute paths', () => {
  assert.throws(() => inspectTarball(gzipTarball([tarEntry('package/../evil.txt', 'x')]), 'x.tgz'), /unsafe archive path/)
  assert.throws(() => inspectTarball(gzipTarball([tarEntry('/etc/passwd', 'x')]), 'x.tgz'), /unsafe archive path/)
})

test('rejects hard links, symlinks, and PAX headers', () => {
  assert.throws(() => inspectTarball(gzipTarball([tarEntry('package/link', 'target', '1')]), 'x.tgz'), /links are not allowed/)
  assert.throws(() => inspectTarball(gzipTarball([tarEntry('package/link', 'target', '2')]), 'x.tgz'), /links are not allowed/)
  assert.throws(() => inspectTarball(gzipTarball([tarEntry('PaxHeader/x', 'meta', 'x')]), 'x.tgz'), /unsupported tar entry type/)
})

test('rejects a tar entry that extends past the archive end', () => {
  const tar = gunzipSync(gzipTarball([
    tarEntry('package/package.json', pluginManifest()),
    tarEntry('package/big.bin', 'x'.repeat(2000)),
  ]))
  const cut = gzipSync(tar.subarray(0, tar.length - 512))
  assert.throws(() => inspectTarball(cut, 'x.tgz'), /truncated tar entry/)
})

test('rejects a tarball without package/package.json', () => {
  assert.throws(() => inspectTarball(gzipTarball([tarEntry('package/readme.md', 'hi')]), 'x.tgz'), /no package\/package\.json/)
})

test('rejects invalid manifests', () => {
  assert.throws(() => inspectTarball(demoTarball(pluginManifest({ name: 'not a valid name!' })), 'x.tgz'), /name is missing or invalid/)
  assert.throws(() => inspectTarball(demoTarball(pluginManifest({ version: '' })), 'x.tgz'), /version is missing/)
  assert.throws(() => inspectTarball(demoTarball(pluginManifest({ dsh: undefined, main: undefined, exports: undefined })), 'x.tgz'), /does not declare/)
  assert.throws(() => inspectTarball(demoTarball('{"name": "demo-plugin"'), 'x.tgz'), /not valid JSON/)
})

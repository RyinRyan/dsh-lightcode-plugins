import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { listInstalledPackages } from '../src/host/installed.js'

function writePackage(root: string, name: string, body: object): void {
  const directory = join(root, 'node_modules', ...name.split('/'))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(body), 'utf8')
}

test('lists direct profile dependencies with resolved metadata but not dependency specifications', () => {
  const profile = mkdtempSync(join(tmpdir(), 'dti-installed-'))
  try {
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-demo': 'file:C:\\private\\demo.tgz', 'plain-lib': '^2.0.0', '@scope/git-lib': 'github:scope/git-lib' }, devDependencies: { ignored: '1.0.0' } }), 'utf8')
    writePackage(profile, 'dsh-demo', { name: 'dsh-demo', version: '1.2.3', description: 'Demo plugin', dsh: { client: { platform: 'web' } } })
    writePackage(profile, 'plain-lib', { name: 'plain-lib', version: '2.4.0' })
    writePackage(profile, '@scope/git-lib', { name: '@scope/git-lib', version: '3.0.0', dsh: { bundle: { patch: './patch.yml' } } })

    assert.deepEqual(listInstalledPackages(profile), [
      { name: '@scope/git-lib', version: '3.0.0', source: 'git', isDshPlugin: true },
      { name: 'dsh-demo', version: '1.2.3', description: 'Demo plugin', source: 'local-file', isDshPlugin: true },
      { name: 'plain-lib', version: '2.4.0', source: 'registry', isDshPlugin: false },
    ])
  } finally { rmSync(profile, { recursive: true, force: true }) }
})

test('keeps an unresolved direct dependency visible and tolerates malformed manifests', () => {
  const profile = mkdtempSync(join(tmpdir(), 'dti-installed-'))
  try {
    mkdirSync(join(profile, 'node_modules'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { missing: 'latest' } }), 'utf8')
    assert.deepEqual(listInstalledPackages(profile), [{ name: 'missing', version: null, source: 'registry', isDshPlugin: false }])
    writeFileSync(join(profile, 'package.json'), '{', 'utf8')
    assert.deepEqual(listInstalledPackages(profile), [])
  } finally { rmSync(profile, { recursive: true, force: true }) }
})

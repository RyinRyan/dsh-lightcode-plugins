import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listInstalledPackages } from '../src/tar-installer/host/installed.js'

test('lists direct dependencies with source and plugin classification', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-installed-'))
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'profile',
      dependencies: { 'plain-pkg': '^1.0.0', 'local-pkg': 'file:../local-pkg', 'missing-pkg': '^2.0.0', '@scope/plugin': 'latest' },
    }))
    await mkdir(join(dir, 'node_modules', 'plain-pkg'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'plain-pkg', 'package.json'), JSON.stringify({ name: 'plain-pkg', version: '1.2.3', description: 'a plain dependency' }))
    await mkdir(join(dir, 'node_modules', '@scope', 'plugin'), { recursive: true })
    await writeFile(join(dir, 'node_modules', '@scope', 'plugin', 'package.json'), JSON.stringify({ name: '@scope/plugin', version: '0.0.1', dsh: { client: { platform: 'web' } } }))

    const packages = listInstalledPackages(dir)
    assert.deepEqual(packages.map(item => item.name), ['@scope/plugin', 'local-pkg', 'missing-pkg', 'plain-pkg'])
    const plain = packages.find(item => item.name === 'plain-pkg')
    assert.equal(plain?.version, '1.2.3')
    assert.equal(plain?.source, 'registry')
    assert.equal(plain?.isDshPlugin, false)
    const scoped = packages.find(item => item.name === '@scope/plugin')
    assert.equal(scoped?.isDshPlugin, true)
    assert.equal(scoped?.source, 'registry')
    const local = packages.find(item => item.name === 'local-pkg')
    assert.equal(local?.version, null)
    assert.equal(local?.source, 'local-file')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('returns an empty list without dependencies or node_modules', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-installed-'))
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'empty' }))
    assert.deepEqual(listInstalledPackages(dir), [])
    await rm(join(dir, 'package.json'), { force: true })
    assert.deepEqual(listInstalledPackages(dir), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

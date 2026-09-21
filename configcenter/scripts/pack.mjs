import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const tarballName = `${manifest.name.replace(/^@/, '').replace(/[\/]/g, '-')}-${manifest.version}.tgz`
await mkdir(dist, { recursive: true })
for (const entry of await readdir(dist)) if (entry.startsWith(`${manifest.name}-`) && entry.endsWith('.tgz')) await rm(resolve(dist, entry), { force: true })
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
if (!existsSync(npmCli)) throw new Error(`npm CLI was not found at ${npmCli}`)
execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', dist, '--ignore-scripts'], { cwd: root, stdio: 'inherit', env: { ...process.env, npm_config_cache: resolve(root, '.npm-cache') } })
const tarball = resolve(dist, tarballName)
const bytes = await stat(tarball)
const digest = createHash('sha256').update(await readFile(tarball)).digest('hex')
console.log(`tarball: ${tarball}`)
console.log(`size: ${bytes.size} bytes`)
console.log(`sha256: ${digest}`)

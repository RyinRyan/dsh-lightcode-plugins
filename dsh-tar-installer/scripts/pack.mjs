import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
await mkdir(dist, { recursive: true })
for (const entry of await readdir(dist)) if (entry.startsWith(`${manifest.name}-`) && entry.endsWith('.tgz')) await rm(join(dist, entry), { force: true })
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
if (!existsSync(npmCli)) throw new Error(`npm CLI not found: ${npmCli}`)
execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', dist, '--ignore-scripts'], { cwd: root, stdio: 'inherit', env: { ...process.env, npm_config_cache: resolve(root, '.npm-cache') } })
const target = resolve(dist, `${manifest.name}-${manifest.version}.tgz`)
const data = await readFile(target)
console.log('tarball:', target)
console.log('size:', (await stat(target)).size, 'bytes')
console.log('sha256:', createHash('sha256').update(data).digest('hex'))

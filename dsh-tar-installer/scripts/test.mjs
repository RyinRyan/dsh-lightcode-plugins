import { readdir } from 'node:fs/promises'
import { once } from 'node:events'
import { run } from 'node:test'
import { spec } from 'node:test/reporters'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import './ts-hooks.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tests = (await readdir(join(root, 'tests'))).filter(name => /\.spec\.(ts|tsx)$/.test(name)).sort().map(name => join(root, 'tests', name))
const stream = run({ files: tests, isolation: 'none' })
let failed = false
stream.on('test:fail', () => { failed = true })
stream.pipe(spec()).pipe(process.stdout)
await Promise.race([once(stream, 'end'), once(stream, 'close')])
process.exit(failed ? 1 : 0)

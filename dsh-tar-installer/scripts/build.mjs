import { nodeResolve } from '@rollup/plugin-node-resolve'
import { rollup } from 'rollup'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from './transpile.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inlineTypeScript = () => ({ name: 'inline-typescript', transform(code, id) { return /\.tsx?$/.test(id) ? transpile(code, id) : null } })
async function bundle(input, output, external, options = {}) {
  const built = await rollup({ input, external, plugins: [inlineTypeScript(), nodeResolve({ extensions: ['.ts', '.tsx', '.mjs', '.js'] })] })
  await built.write({ file: output, sourcemap: true, ...options })
  await built.close()
}

await rm(resolve(root, 'lib'), { recursive: true, force: true })
await mkdir(resolve(root, 'lib'), { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-b', resolve(root, 'tsconfig.json'), '--force'], { cwd: root, stdio: 'inherit' })
await bundle(resolve(root, 'src/index.ts'), resolve(root, 'lib/index.js'), id => id.startsWith('node:'), { format: 'esm' })
const banner = 'window.__ModuleLoader__.load({\n  id: "dsh-tar-installer",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });'
const footer = '    return module.exports;\n  }\n});'
await bundle(resolve(root, 'src/client/index.ts'), resolve(root, 'lib/client.js'), id => id === 'react' || id === 'react/jsx-runtime' || id === '@deepseek-ai/cordis' || /^@deepseek-ai\/dsh-client/.test(id), { format: 'cjs', exports: 'named', banner, footer })
const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
const host = await readFile(resolve(root, 'lib/index.js'), 'utf8')
if (!client.includes('id: "dsh-tar-installer"') || /["']node:(?:fs|path|http|child_process)/.test(client)) throw new Error('client bundle safety check failed')
if (/(?:from|require\()\s*["']@deepseek-ai\//.test(host)) throw new Error('host bundle has runtime @deepseek-ai imports')
console.log('build checks passed')

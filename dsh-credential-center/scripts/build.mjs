import { nodeResolve } from '@rollup/plugin-node-resolve'
import { rollup } from 'rollup'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from './transpile.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function inlineTypeScript() {
  return { name: 'dsh-credential-center:inline-typescript', transform(code, id) { return /\.tsx?$/.test(id) ? transpile(code, id) : null } }
}

async function bundle(input, output, options) {
  const build = await rollup({ input, plugins: [inlineTypeScript(), nodeResolve({ extensions: ['.ts', '.tsx', '.mjs', '.js'] })], ...options.rollup })
  await build.write({ file: output, sourcemap: true, sourcemapPathTransform: relative => relative, ...options.output })
  await build.close()
}

const banner = ['window.__ModuleLoader__.load({', '\tid: "dsh-credential-center",', '\tfactory: (require) => {', '\t\tvar module = { exports: {} };', '\t\tvar exports = module.exports;', '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });'].join('\n')
const footer = ['\t\treturn module.exports;', '\t}', '});'].join('\n')

await rm(resolve(root, 'lib'), { recursive: true, force: true })
await mkdir(resolve(root, 'lib'), { recursive: true })
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-b', resolve(root, 'tsconfig.json'), '--force'], { cwd: root, stdio: 'inherit' })
await bundle(resolve(root, 'src/index.ts'), resolve(root, 'lib/index.js'), { rollup: { external: id => id.startsWith('node:') }, output: { format: 'esm' } })
await bundle(resolve(root, 'src/client/index.ts'), resolve(root, 'lib/client.js'), {
  rollup: { external: id => id === 'react' || id === 'react-dom' || id === 'react-dom/client' || id === 'react/jsx-runtime' || id === '@deepseek-ai/cordis' || /^@deepseek-ai\/dsh-client/.test(id) },
  output: { format: 'cjs', banner, footer, exports: 'named' },
})

const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
const host = await readFile(resolve(root, 'lib/index.js'), 'utf8')
const failures = []
if (!client.includes('window.__ModuleLoader__.load({') || !client.includes('id: "dsh-credential-center"')) failures.push('client ModuleLoader wrapper is missing')
if (/react\.development\.js|React Version/.test(client)) failures.push('client embeds React')
for (const marker of ['node:fs', 'node:path', 'node:os', 'node:http', 'node:crypto']) if (client.includes(marker)) failures.push(`client references ${marker}`)
if ([...host.matchAll(/(?:from|require\()\s*["'](@deepseek-ai\/[a-z0-9-]+)["']/g)].length > 0) failures.push('host has runtime @deepseek-ai imports')
if (failures.length > 0) throw new Error(failures.join('\n'))
console.log('build checks passed')

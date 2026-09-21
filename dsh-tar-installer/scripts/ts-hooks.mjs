import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transpile } from './transpile.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (error) {
      if (specifier.endsWith('.js')) {
        for (const extension of ['.ts', '.tsx']) {
          try { return nextResolve(`${specifier.slice(0, -3)}${extension}`, context) } catch { /* next */ }
        }
      }
      throw error
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:')) {
      const path = fileURLToPath(url)
      if (/\.tsx?$/.test(path)) {
        return { format: 'module', shortCircuit: true, source: transpile(readFileSync(path, 'utf8'), path).code }
      }
    }
    return nextLoad(url, context)
  },
})

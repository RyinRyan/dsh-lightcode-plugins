import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { transpile } from './transpile.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
  const value = dom.window[key]
  if (value !== undefined && globalThis[key] === undefined) globalThis[key] = value
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.endsWith('.js')) {
        for (const candidate of [`${specifier.slice(0, -3)}.ts`, `${specifier.slice(0, -3)}.tsx`]) {
          try { return nextResolve(candidate, context) } catch { /* try the next extension */ }
        }
      }
      throw error
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:')) {
      const path = fileURLToPath(url)
      if (path.endsWith('.ts') || path.endsWith('.tsx')) {
        return { format: 'module', shortCircuit: true, source: transpile(readFileSync(path, 'utf8'), path).code }
      }
    }
    return nextLoad(url, context)
  },
})

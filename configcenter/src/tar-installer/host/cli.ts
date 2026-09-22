/**
 * Locating the DSH CLI that launched this host.
 *
 * Child commands (`dsh plugin add/remove`) and the self-restart both need to
 * re-invoke the same DSH installation, so the launcher detection lives here
 * once instead of being re-derived per call site.
 */
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/**
 * Absolute path of the DSH launcher (`bin.js` / `bin.ts` / the `dsh` shim),
 * or `undefined` when this host was not started through an identifiable one.
 */
export function dshLauncherPath(): string | undefined {
  const entry = process.argv[1]
  return entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry) ? resolve(entry) : undefined
}

/** The Node binary to re-invoke, preferring the exact one running this host. */
export function nodeExecutable(): string {
  return process.argv0 !== '' && isAbsolute(process.argv0) && existsSync(process.argv0)
    ? process.argv0
    : process.execPath
}

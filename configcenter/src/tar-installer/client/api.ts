/** Browser API client for the installer routes. */
import { ROUTE_PREFIX, type InstallerSnapshot, type PackagePreview } from '../shared/protocol.js'
import { type FetchLike, fetchJson, jsonInit, unwrapJson } from '../../client/http.js'

export interface InstallerApi {
  status(): Promise<InstallerSnapshot>
  inspect(file: File): Promise<PackagePreview>
  install(token: string, allowScripts: boolean): Promise<void>
  restart(): Promise<void>
  remove(name: string): Promise<void>
}

/**
 * Create the same-origin browser API. Uploads stream the raw file body and
 * deliberately carry no request timeout; every other call is bounded.
 */
export function createInstallerApi(
  doFetch: FetchLike = (input, init) => globalThis.fetch(input, init),
): InstallerApi {
  return {
    async status() {
      return unwrapJson<InstallerSnapshot>(await fetchJson(doFetch, `${ROUTE_PREFIX}/status`, { cache: 'no-store' }))
    },
    async inspect(file) {
      return unwrapJson<PackagePreview>(await doFetch(`${ROUTE_PREFIX}/inspect`, {
        method: 'POST',
        headers: {
          'content-type': 'application/gzip',
          'x-dsh-file-name': encodeURIComponent(file.name),
        },
        body: file,
      }))
    },
    async install(token, allowScripts) {
      await unwrapJson(await fetchJson(doFetch, `${ROUTE_PREFIX}/install`, jsonInit({ token, allowScripts })))
    },
    async restart() {
      await unwrapJson(await fetchJson(doFetch, `${ROUTE_PREFIX}/restart`, { method: 'POST' }))
    },
    async remove(name) {
      await unwrapJson(await fetchJson(doFetch, `${ROUTE_PREFIX}/remove`, jsonInit({ name })))
    },
  }
}

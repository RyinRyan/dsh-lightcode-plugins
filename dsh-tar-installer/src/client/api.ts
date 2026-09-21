import { ROUTE_PREFIX, type ApiResult, type InstallerSnapshot, type PackagePreview } from '../shared/protocol.js'

async function unwrap<T>(response: Response): Promise<T> {
  const body = await response.json() as ApiResult<T>
  if (!body.ok) throw new Error(body.error.message)
  return body.value
}

export interface InstallerApi {
  status(): Promise<InstallerSnapshot>
  inspect(file: File): Promise<PackagePreview>
  install(token: string, allowScripts: boolean): Promise<void>
  restart(): Promise<void>
}

export function createInstallerApi(fetcher: typeof fetch = fetch): InstallerApi {
  return {
    async status() {
      return unwrap<InstallerSnapshot>(await fetcher(`${ROUTE_PREFIX}/status`, { cache: 'no-store' }))
    },
    async inspect(file) {
      return unwrap<PackagePreview>(await fetcher(`${ROUTE_PREFIX}/inspect`, {
        method: 'POST',
        headers: {
          'content-type': 'application/gzip',
          'x-dsh-file-name': encodeURIComponent(file.name),
        },
        body: file,
      }))
    },
    async install(token, allowScripts) {
      await unwrap(await fetcher(`${ROUTE_PREFIX}/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, allowScripts }),
      }))
    },
    async restart() {
      await unwrap(await fetcher(`${ROUTE_PREFIX}/restart`, { method: 'POST' }))
    },
  }
}

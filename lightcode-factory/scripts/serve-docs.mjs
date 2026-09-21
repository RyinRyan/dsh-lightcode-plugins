import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = resolve(fileURLToPath(new URL('../docs/plugin-development/', import.meta.url)))
const requestedPort = Number(process.env.DOCS_PORT ?? process.argv[2] ?? 4173)
if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
  throw new Error('Port must be an integer between 1 and 65535')
}

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.md', 'text/markdown; charset=utf-8'],
])

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    if (pathname === '/') {
      response.writeHead(302, { Location: '/site/' }).end()
      return
    }
    const candidate = resolve(docsRoot, '.' + pathname)
    if (candidate !== docsRoot && !candidate.startsWith(docsRoot + sep)) {
      response.writeHead(403).end('Forbidden')
      return
    }
    const info = await stat(candidate)
    const file = info.isDirectory() ? resolve(candidate, 'index.html') : candidate
    const body = await readFile(file)
    response.writeHead(200, {
      'Content-Type': types.get(extname(file)) ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    response.end(body)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 404 : 500
    response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(code === 404 ? 'Not found' : 'Internal server error')
  }
})

server.listen(requestedPort, '127.0.0.1', () => {
  console.log(`DSH plugin guide: http://127.0.0.1:${requestedPort}`)
})

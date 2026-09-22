/** Minimal ustar builder for crafting tarballs in tests. */
import { gzipSync } from 'node:zlib'

export function tarHeader(name: string, size: number, typeflag = '0'): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  header.write(typeflag, 156, 'ascii')
  header.write('ustar', 257, 'ascii')
  header.write('00', 263, 'ascii')
  header.fill(' ', 148, 156)
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return header
}

export function tarEntry(name: string, content: string, typeflag = '0'): Buffer {
  const data = Buffer.from(content, 'utf8')
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([tarHeader(name, data.length, typeflag), data, padding])
}

export function gzipTarball(entries: readonly Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries]))
}

export function pluginManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'demo-plugin',
    version: '1.2.3',
    description: 'a demo plugin',
    main: 'lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    ...overrides,
  })
}

/** A well-formed npm-style tarball for `demo-plugin`. */
export function demoTarball(manifest: string = pluginManifest()): Buffer {
  return gzipTarball([
    tarEntry('package/package.json', manifest),
    tarEntry('package/lib/index.js', 'export const name = "demo-plugin"\n'),
    tarEntry('package/cordis.patch.yml', '- insert:\n    - id: demo-plugin\n      name: demo-plugin\n'),
  ])
}

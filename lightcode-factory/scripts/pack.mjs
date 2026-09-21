import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script using npm run pack.');
function run(args, cwd) {
  const result = spawnSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}
const tarballs = {};
for (const dir of ['contracts', 'runtime', 'storage-sqlite', 'workflows', 'web']) {
  const manifest = JSON.parse(await readFile(join(root, 'packages', dir, 'package.json'), 'utf8'));
  const output = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', dist], join(root, 'packages', dir)));
  tarballs[manifest.name] = join(dist, output[0].filename);
}
// Stage real installed files rather than workspace symlinks; the bundle ships all member plugins.
const stage = await mkdtemp(join(dist, '.pack-'));
const factory = join(root, 'packages/factory');
const manifest = JSON.parse(await readFile(join(factory, 'package.json'), 'utf8'));
try {
  await cp(join(factory, 'cordis.patch.yml'), join(stage, 'cordis.patch.yml'));
  await cp(join(factory, 'index.js'), join(stage, 'index.js'));
  await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    ...manifest, dependencies: Object.fromEntries(Object.entries(tarballs).map(([name, path]) => [name, 'file:' + path.replaceAll('\\', '/')])),
  }, null, 2));
  run(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
  const packed = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', dist], stage));
  console.log(join(dist, packed[0].filename));
} finally {
  await rm(stage, { recursive: true, force: true });
}

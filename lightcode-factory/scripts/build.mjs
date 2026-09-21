import { build } from 'esbuild';
import { transform } from 'lightningcss';
import { readFile, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const members = ['contracts', 'runtime', 'storage-sqlite', 'workflows', 'web'];
for (const dir of members) await rm(resolve(root, 'packages', dir, 'lib'), { recursive: true, force: true });
const typecheck = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], { stdio: 'inherit' });
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

for (const dir of members) {
  await build({
    entryPoints: [`packages/${dir}/src/index.ts`], outfile: `packages/${dir}/lib/index.js`,
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
    packages: 'external', tsconfig: 'tsconfig.base.json', sourcemap: true,
  });
}
const shared = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit'];
for (const [dir, name] of [['runtime', 'lightcode-factory-runtime'], ['web', 'lightcode-factory-web']]) {
  await build({
    entryPoints: [`packages/${dir}/src/client/index.ts`], outfile: `packages/${dir}/lib/client.js`,
    bundle: true, platform: 'browser', format: 'cjs', target: 'es2022',
    tsconfig: 'tsconfig.base.json', external: shared, sourcemap: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
    footer: { js: 'return module.exports;}});' },
    plugins: [{
      name: 'plugin-owned-css',
      setup(builder) {
        builder.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => {
          const result = transform({ filename: basename(path), code: await readFile(path), cssModules: true, minify: true });
          const mapping = Object.fromEntries(Object.entries(result.exports ?? {}).map(([key, value]) => [key, value.name]));
          const css = result.code.toString();
          return { loader: 'js', contents: `const key=${JSON.stringify(name+'/'+basename(path))};if(!document.querySelector('style[data-plugin-css="'+key+'"]')){const s=document.createElement('style');s.dataset.pluginCss=key;s.textContent=${JSON.stringify(css)};document.head.appendChild(s)}export default ${JSON.stringify(mapping)};` };
        });
      },
    }],
  });
}
console.log('Built independent host and browser plugin artifacts.');

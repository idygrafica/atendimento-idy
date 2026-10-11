import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'public', '.netlify'].includes(item.name)) continue;
    const url = new URL(item.name + (item.isDirectory() ? '/' : ''), dir);
    if (item.isDirectory()) await walk(url);
    else if (/\.(?:js|mjs|cjs)$/.test(item.name)) {
      const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    } else if (/\.html$/.test(item.name)) {
      const html = await readFile(url, 'utf8');
      for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(script[1]);
    }
  }
}
await walk(root);
console.log('Sintaxe JavaScript das funções, módulos, testes e páginas: OK.');

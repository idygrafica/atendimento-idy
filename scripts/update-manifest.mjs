import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('MANIFESTO.json', root), 'utf8'));
const paths = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
paths.add('package-lock.json');
paths.add('recovery-evidence/functions-build.json');
paths.delete('MANIFESTO.json');
manifest.files = [];
for (const path of [...paths].sort()) {
  const data = await readFile(new URL(path, root));
  manifest.files.push({ path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
await writeFile(new URL('MANIFESTO.json', root), JSON.stringify(manifest, null, 2) + '\n');

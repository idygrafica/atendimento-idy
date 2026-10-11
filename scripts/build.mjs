import { mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const destination = new URL('public/', root);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of ['index.html', 'painel.html', 'politica-de-privacidade.html', 'exclusao-de-dados.html']) {
  await copyFile(new URL(name, root), new URL(name, destination));
}
console.log(`Build local: somente quatro páginas em ${fileURLToPath(destination)}. Nenhum deploy executado.`);

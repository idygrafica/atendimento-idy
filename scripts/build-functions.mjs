import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';
import { zipFunctions } from '@netlify/zip-it-and-ship-it';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
for (const name of ['@netlify/blobs', '@netlify/zip-it-and-ship-it']) {
  const version = pkg.dependencies?.[name] || pkg.devDependencies?.[name];
  assert.match(version, /^\d+\.\d+\.\d+$/, `${name} precisa de uma versão estável exata`);
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
}
// API do SDK instalado, sem consultar armazenamento ou credenciais reais.
const store = getStore({ name: 'idy-sdk-validation', siteID: 'test-site', token: 'test-token' });
for (const name of ['getWithMetadata', 'setJSON', 'list']) assert.equal(typeof store[name], 'function');

const output = new URL('../.netlify/functions-validation/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const functions = await zipFunctions(`${root}netlify/functions`, fileURLToPath(output), {
  archiveFormat: 'none',
  basePath: root,
  config: { '*': { nodeBundler: 'esbuild', nodeVersion: '22.x' } }
});
const expected = ['chat', 'creative-preview', 'health', 'notify-idy-whatsapp', 'panel-api', 'whatsapp-webhook'];
assert.deepEqual(functions.map(fn => fn.name).sort(), expected.sort());
for (const fn of functions) {
  assert.equal(fn.bundler, 'esbuild', `${fn.name}: bundler`);
  assert.ok(!fn.bundlerErrors?.length, `${fn.name}: erros de bundle`);
  if (['panel-api', 'whatsapp-webhook'].includes(fn.name)) {
    assert.equal(fn.runtimeAPIVersion, 2, `${fn.name}: API v2`);
    assert.ok(fn.inputs.some(path => path.includes('/node_modules/@netlify/blobs/')), `${fn.name}: SDK real incluído`);
  }
}
const report = {
  node: process.version,
  sdk: pkg.dependencies['@netlify/blobs'],
  bundler: pkg.devDependencies['@netlify/zip-it-and-ship-it'],
  dependency_api: 'passed (real SDK; no remote storage request)',
  functions: functions.map(({ name, bundler, runtimeAPIVersion, runtimeVersion }) => ({ name, bundler, runtimeAPIVersion, runtimeVersion, result: 'passed' })),
  remote_providers: 'not tested',
  deployment: 'not executed'
};
await mkdir(new URL('../recovery-evidence/', import.meta.url), { recursive: true });
await writeFile(new URL('../recovery-evidence/functions-build.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

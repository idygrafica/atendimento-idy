import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// DOM mínimo para testar fluxos de eventos; não substitui avaliação visual em navegador.
class Element {
  value = ''; textContent = ''; children = []; hidden = false; disabled = false; dataset = {}; events = new Map();
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  get scrollHeight() { return this.children.length; }
  appendChild(child) { this.children.push(child); }
  addEventListener(name, fn) { this.events.set(name, fn); }
  async trigger(name, event = {}) { return await this.events.get(name)?.(event); }
  focus() {} click() { return this.trigger('click'); } showModal() { this.open = true; } close() { this.open = false; }
}
async function page(filename, fetchImpl) {
  const html = await readFile(new URL('../' + filename, import.meta.url), 'utf8');
  const elements = new Map(); const intervals = []; const stored = new Map(); const alerts = [];
  for (const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)) {
    const element = new Element(); element.hidden = /\bhidden\b/.test(match[0]); elements.set(match[1], element);
  }
  const get = id => elements.get(id) || (() => { throw new Error('Elemento não encontrado: ' + id); })();
  const document = { hidden: false, getElementById: get, createElement: () => new Element() };
  const context = vm.createContext({ document, fetch: fetchImpl, FormData, Intl, Date, Math, Map, encodeURIComponent, console, alert: message => alerts.push(message), sessionStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) }, setInterval: (fn, ms) => { intervals.push({ fn, ms }); } });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { get, context, intervals, stored, alerts, document, html };
}

test('interface bloqueia Enter concorrente e libera envio após resposta', async () => {
  let calls = 0; let release;
  const wait = new Promise(resolve => { release = resolve; });
  const p = await page('index.html', async () => { calls++; await wait; return Response.json({ answer: 'Resposta de teste' }); });
  p.get('message').value = 'Primeira'; const pending = p.get('send').trigger('click');
  p.get('message').value = 'Segunda'; await p.get('message').trigger('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(calls, 1); assert.equal(p.get('send').disabled, true);
  release(); await pending; assert.equal(p.get('send').disabled, false);
  assert.equal(p.get('chat').children.length, 2);
});
test('registro do formulário não promete aviso WhatsApp quando aviso falha', async () => {
  const p = await page('index.html', async url => url === '/' ? new Response('registrado') : Response.json({ ok: false }, { status: 502 }));
  p.get('clientName').value = 'Teste'; p.get('clientPhone').value = '5551988887777';
  await p.get('submitLead').trigger('click');
  assert.match(p.get('status').textContent, /registrado.*não foi confirmado/);
  assert.equal(p.get('submitLead').disabled, false);
});
test('diagnóstico da interface continua compatível com health', async () => {
  const p = await page('index.html', async () => Response.json({ status: 'netlify-function-ok', hasKey: false }));
  await p.get('health').trigger('click'); assert.match(p.get('healthResult').textContent, /OPENAI_API_KEY ausente/);
});
function panelMock() {
  const convs = {
    a: { phone: 'a', name: 'A', mode: 'ai', messages: [{ role: 'user', text: 'Briefing A', at: '2026-10-11T12:00:00Z' }] },
    b: { phone: 'b', name: 'B', mode: 'ai', messages: [{ role: 'user', text: 'Briefing B', at: '2026-10-11T12:00:00Z' }] },
  };
  return async url => {
    const query = new URL(url, 'https://test.local').searchParams.get('phone');
    return Response.json(query ? { conversation: convs[query] } : { conversations: Object.values(convs) });
  };
}
test('painel separa briefings dos clientes e conserva rascunho ao retornar', async () => {
  const p = await page('painel.html', panelMock()); p.get('accessKey').value = 'chave-ficticia'; await p.get('loginBtn').trigger('click');
  await p.get('convlist').children[0].trigger('click'); assert.equal(p.get('brief').value, 'Briefing A');
  p.get('brief').value = 'Rascunho A'; await p.get('convlist').children[1].trigger('click'); assert.equal(p.get('brief').value, 'Briefing B');
  await p.get('convlist').children[0].trigger('click'); assert.equal(p.get('brief').value, 'Rascunho A');
});
test('painel não persiste chave e logout remove os dados visíveis', async () => {
  const p = await page('painel.html', panelMock()); p.get('accessKey').value = 'chave-ficticia'; await p.get('loginBtn').trigger('click');
  assert.equal(p.stored.size, 0); assert.equal(p.get('accessKey').value, ''); assert.equal(p.get('app').hidden, false);
  await p.get('logoutBtn').trigger('click'); assert.equal(p.get('app').hidden, true); assert.equal(p.get('login').hidden, false); assert.equal(p.get('messages').children.length, 0);
});
test('painel informa erro de atualização e pausa polling em aba oculta', async () => {
  const p = await page('painel.html', async () => Response.json({ error: 'Falha simulada' }, { status: 503 }));
  await p.get('refreshBtn').trigger('click'); assert.equal(p.get('panelStatus').textContent, 'Falha simulada');
  assert.equal(p.intervals[0].ms, 10000); p.document.hidden = true; p.get('app').hidden = false; p.intervals[0].fn();
  assert.equal(vm.runInContext('loading', p.context), false);
});

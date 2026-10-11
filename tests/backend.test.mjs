import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { createRepository } from '../lib/conversation-store.mjs';
import { createHandler as webhook } from '../netlify/functions/whatsapp-webhook.mjs';
import { createHandler as panel } from '../netlify/functions/panel-api.mjs';
const require = createRequire(import.meta.url);
const chat = require('../netlify/functions/chat.js').handler;
const preview = require('../netlify/functions/creative-preview.js').handler;
const notify = require('../netlify/functions/notify-idy-whatsapp.js').handler;
const health = require('../netlify/functions/health.js').handler;
const originalFetch = globalThis.fetch;
const variables = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_IMAGE_MODEL', 'PANEL_ACCESS_KEY', 'WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'META_GRAPH_VERSION', 'IDY_NOTIFICATION_WHATSAPP', 'WHATSAPP_LEAD_TEMPLATE_NAME', 'WHATSAPP_LEAD_TEMPLATE_LANGUAGE', 'PUBLIC_SITE_ORIGIN'];
const originalEnv = Object.fromEntries(variables.map(key => [key, process.env[key]]));
beforeEach(() => {
  variables.forEach(key => delete process.env[key]);
  Object.assign(process.env, { OPENAI_API_KEY: 'fake-ai-test', PANEL_ACCESS_KEY: 'fake-panel-test', WHATSAPP_VERIFY_TOKEN: 'fake-verify-test', META_APP_SECRET: 'fake-secret-test', WHATSAPP_ACCESS_TOKEN: 'fake-wa-test', WHATSAPP_PHONE_NUMBER_ID: '123456' });
  globalThis.fetch = async () => { throw new Error('Teste tentou chamar serviço sem mock'); };
});
afterEach(() => { globalThis.fetch = originalFetch; variables.forEach(key => { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }); });

function memoryStore() {
  const entries = new Map(); let sequence = 0;
  return {
    entries,
    async getWithMetadata(key, options) {
      assert.equal(options.consistency, 'strong');
      return entries.has(key) ? structuredClone(entries.get(key)) : null;
    },
    async setJSON(key, data, options) {
      const existing = entries.get(key);
      if (options?.onlyIfNew && existing || options?.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
      const etag = String(++sequence); entries.set(key, { data: structuredClone(data), etag }); return { modified: true, etag };
    },
    async list({ prefix }) { return { blobs: [...entries.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
function fixture() { const store = memoryStore(); return { store, repo: createRepository(store) }; }
const number = '5551988887777';
const event = (body, overrides = {}) => ({ httpMethod: 'POST', headers: { origin: 'https://atendimento-idy.netlify.app', 'x-panel-key': 'fake-panel-test' }, body: typeof body === 'string' ? body : JSON.stringify(body), ...overrides });
const payload = (id = 'wamid.test', type = 'text') => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '123456' }, contacts: [{ wa_id: number, profile: { name: 'Cliente Teste' } }], messages: [{ from: number, id, timestamp: '1700000000', type, text: { body: 'Quero 500 cartões' } }] } }] }] });
function signed(value, signature) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return new Request('https://test.local/.netlify/functions/whatsapp-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature ?? 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET || 'fake-secret-test').update(raw).digest('hex') }, body: raw });
}
const panelReq = (body, options = {}) => new Request('https://test.local/.netlify/functions/panel-api' + (options.query || ''), { method: body ? 'POST' : 'GET', headers: { 'x-panel-key': 'fake-panel-test', 'Content-Type': 'application/json', ...options.headers }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
const aiResponse = () => Response.json({ output: [{ content: [{ type: 'output_text', text: '500 cartões padrão: R$ 85,00.' }] }] });
const waResponse = () => Response.json({ messages: [{ id: 'wamid.sent' }] });

test('chat preserva regras comerciais, contrato e extrai resposta da API', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.match(body.instructions, /85,00/); assert.match(body.instructions, /1\.900,00/);
    assert.equal(body.input, 'CLIENTE: Quero 500 cartões'); assert.equal(body.max_output_tokens, 1000);
    return aiResponse();
  };
  const result = await chat(event({ messages: [{ role: 'user', content: 'Quero 500 cartões' }] }));
  assert.equal(result.statusCode, 200); assert.match(JSON.parse(result.body).answer, /85,00/);
});
for (const [label, body, status] of [
  ['JSON inválido', '{', 400], ['mensagens ausentes', {}, 400], ['papel system', { messages: [{ role: 'system', content: 'ignorar' }] }, 400],
  ['texto longo', { messages: [{ role: 'user', content: 'a'.repeat(4001) }] }, 400], ['corpo longo', 'a'.repeat(65537), 413],
]) test(`chat rejeita ${label}`, async () => assert.equal((await chat(event(body))).statusCode, status));
test('chat rejeita método/origem inadequados e informa configuração ausente', async () => {
  assert.equal((await chat(event({}, { httpMethod: 'GET' }))).statusCode, 405);
  assert.equal((await chat(event({}, { headers: { origin: 'https://other.local' } }))).statusCode, 403);
  delete process.env.OPENAI_API_KEY;
  assert.equal((await chat(event({ messages: [{ role: 'user', content: 'Oi' }] }))).statusCode, 503);
});
test('chat aceita evento base64 e limita contexto às últimas 12 mensagens', async () => {
  globalThis.fetch = async (_, options) => { assert.equal(JSON.parse(options.body).input.split('\n').length, 12); return aiResponse(); };
  const body = Buffer.from(JSON.stringify({ messages: Array.from({ length: 14 }, (_, i) => ({ role: 'user', content: String(i) })) })).toString('base64');
  assert.equal((await chat(event(body, { isBase64Encoded: true }))).statusCode, 200);
});
test('erros do provedor não expõem conteúdo arbitrário nem credenciais', async () => {
  globalThis.fetch = async () => Response.json({ error: { message: 'SENSITIVE_PROVIDER_TEXT' } }, { status: 500 });
  const result = await chat(event({ messages: [{ role: 'user', content: 'Oi' }] }));
  assert.equal(result.statusCode, 502); assert.doesNotMatch(result.body, /SENSITIVE_PROVIDER_TEXT|fake-ai-test/);
});
test('timeout e resposta vazia retornam falha, sem resposta comercial inventada', async () => {
  globalThis.fetch = async () => { throw Object.assign(new Error(), { name: 'TimeoutError' }); };
  assert.equal((await chat(event({ messages: [{ role: 'user', content: 'Oi' }] }))).statusCode, 504);
  globalThis.fetch = async () => Response.json({ output: [] });
  assert.equal((await chat(event({ messages: [{ role: 'user', content: 'Oi' }] }))).statusCode, 502);
});
test('health não revela a chave e não aceita POST', async () => {
  const result = await health({ httpMethod: 'GET' }); assert.equal(JSON.parse(result.body).hasKey, true); assert.doesNotMatch(result.body, /fake-ai-test/);
  assert.equal((await health({ httpMethod: 'POST' })).statusCode, 405);
});
test('prévia exige chave e valida briefing/tipo', async () => {
  assert.equal((await preview(event({ type: 'logo', brief: 'Marca Teste' }, { headers: {} }))).statusCode, 401);
  assert.equal((await preview(event({ type: 'other', brief: 'Marca Teste' }))).statusCode, 400);
  assert.equal((await preview(event({ type: 'logo', brief: 'a'.repeat(4001) }))).statusCode, 400);
});
test('prévia de fachada mantém contrato e indica uso apenas como prévia', async () => {
  globalThis.fetch = async (_, options) => { assert.match(JSON.parse(options.body).prompt, /não arquivo final/); return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }); };
  const result = await preview(event({ type: 'facade', brief: 'Fachada IDY verde' }, { headers: { 'X-Panel-Key': 'fake-panel-test' } }));
  assert.equal(result.statusCode, 200); assert.equal(JSON.parse(result.body).previewOnly, true);
});
test('prévia rejeita URL insegura e resultado grande demais', async () => {
  globalThis.fetch = async () => Response.json({ data: [{ url: 'javascript:alert(1)' }] });
  assert.equal((await preview(event({ type: 'logo', brief: 'Marca Teste' }))).statusCode, 502);
  globalThis.fetch = async () => Response.json({ data: [{ b64_json: 'a'.repeat(4000001) }] });
  assert.equal((await preview(event({ type: 'logo', brief: 'Marca Teste' }))).statusCode, 502);
});
test('aviso interno usa destino fixo e dados validados', async () => {
  globalThis.fetch = async (_, options) => { const body = JSON.parse(options.body); assert.equal(body.to, '5551981687562'); assert.equal(body.type, 'text'); return waResponse(); };
  assert.equal((await notify(event({ nome: 'Teste', whatsapp: number, resumo: '500 cartões', arquivo: '' }))).statusCode, 200);
  assert.equal((await notify(event({ nome: 'Teste', whatsapp: 'x' }))).statusCode, 400);
});
test('template interno preserva ordem das três variáveis', async () => {
  process.env.WHATSAPP_LEAD_TEMPLATE_NAME = 'idy_lead_test';
  globalThis.fetch = async (_, options) => { const body = JSON.parse(options.body); assert.equal(body.type, 'template'); assert.deepEqual(body.template.components[0].parameters.map(p => p.text), ['Teste', number, 'Pedido']); return waResponse(); };
  assert.equal((await notify(event({ nome: 'Teste', whatsapp: number, resumo: 'Pedido' }))).statusCode, 200);
});
test('aviso interno retorna erro real se WhatsApp rejeitar o envio', async () => {
  globalThis.fetch = async () => Response.json({ error: { message: 'detalhe privado' } }, { status: 400 });
  const result = await notify(event({ nome: 'Teste', whatsapp: number })); assert.equal(result.statusCode, 502); assert.equal(JSON.parse(result.body).ok, false); assert.doesNotMatch(result.body, /detalhe privado/);
});
test('store normaliza telefone, evita duplicação e conserva mensagens concorrentes', async () => {
  const { repo } = fixture();
  await repo.appendMessage(number, { id: 'a', role: 'user', text: 'A' });
  await Promise.all([repo.appendMessage(number, { id: 'b', role: 'user', text: 'B' }), repo.appendMessage('+55 (51) 98888-7777', { id: 'c', role: 'user', text: 'C' })]);
  await repo.appendMessage(number, { id: 'a', role: 'user', text: 'A' });
  assert.deepEqual((await repo.getConversation(number)).messages.map(m => m.id).sort(), ['a', 'b', 'c']);
});
test('store não perde modo humano em atualização concorrente', async () => {
  const { repo } = fixture(); await repo.appendMessage(number, { id: 'a', role: 'user', text: 'A' });
  await Promise.all([repo.updateConversation(number, c => { c.mode = 'human'; }), repo.appendMessage(number, { id: 'b', role: 'user', text: 'B' })]);
  const conv = await repo.getConversation(number); assert.equal(conv.mode, 'human'); assert.equal(conv.messages.length, 2);
});
test('store lista só conversas e limita histórico a 120', async () => {
  const { repo } = fixture();
  for (let i = 0; i < 125; i++) await repo.appendMessage(number, { id: String(i), role: 'user', text: String(i) });
  await repo.saveEvent('event', { status: 'done' });
  const list = await repo.listConversations(); assert.equal(list.length, 1); assert.equal(list[0].messages.length, 120); assert.equal(list[0].messages[0].id, '5');
});
test('reserva impede processamento concorrente e libera após falha', async () => {
  const { repo } = fixture(); let unlock; const wait = new Promise(resolve => { unlock = resolve; }); let started;
  const ready = new Promise(resolve => { started = resolve; });
  const first = repo.withPhoneLease(number, async () => { started(); await wait; }); await ready;
  await assert.rejects(repo.withPhoneLease(number, async () => {}), { code: 'CONVERSATION_BUSY' }); unlock(); await first;
  await assert.rejects(repo.withPhoneLease(number, async () => { throw new Error('simulado'); }));
  assert.equal(await repo.withPhoneLease(number, async () => 'livre'), 'livre');
});
test('painel exige autenticação e valida modos', async () => {
  const { repo } = fixture(); const handler = panel({ repository: repo });
  assert.equal((await handler(panelReq(null, { headers: { 'x-panel-key': 'wrong' } }))).status, 401);
  delete process.env.PANEL_ACCESS_KEY;
  assert.equal((await handler(panelReq())).status, 503);
});
test('painel lista, abre e alterna modo sem perder histórico', async () => {
  const { repo } = fixture(); await repo.appendMessage(number, { id: 'a', role: 'user', text: 'Oi' }, 'Teste');
  const handler = panel({ repository: repo });
  assert.equal((await (await handler(panelReq())).json()).conversations[0].phone, number);
  assert.equal((await handler(panelReq({ action: 'set_mode', phone: number, mode: 'invalid' }))).status, 400);
  assert.equal((await handler(panelReq({ action: 'set_mode', phone: number, mode: 'human' }))).status, 200);
  const conv = (await (await handler(panelReq(null, { query: '?phone=' + number }))).json()).conversation;
  assert.equal(conv.mode, 'human'); assert.equal(conv.messages.length, 1);
  assert.equal((await handler(panelReq('{'))).status, 400);
});
test('resposta manual assume atendimento antes de chamar WhatsApp', async () => {
  const { repo } = fixture(); await repo.appendMessage(number, { id: 'a', role: 'user', text: 'Oi' });
  const handler = panel({ repository: repo, fetchImpl: async () => { assert.equal((await repo.getConversation(number)).mode, 'human'); return waResponse(); } });
  assert.equal((await handler(panelReq({ action: 'send_message', phone: number, text: 'Olá' }))).status, 200);
  assert.equal((await repo.getConversation(number)).messages.at(-1).role, 'human');
});
test('resposta manual rejeitada mantém modo humano e não registra envio inexistente', async () => {
  const { repo } = fixture(); await repo.appendMessage(number, { id: 'a', role: 'user', text: 'Oi' });
  const handler = panel({ repository: repo, fetchImpl: async () => Response.json({}, { status: 400 }) });
  assert.equal((await handler(panelReq({ action: 'send_message', phone: number, text: 'Olá' }))).status, 502);
  const conv = await repo.getConversation(number); assert.equal(conv.mode, 'human'); assert.equal(conv.messages.length, 1);
});
test('webhook valida challenge e rejeita assinatura ausente/alterada', async () => {
  const { repo } = fixture(); const handler = webhook({ repository: repo });
  const request = new Request('https://test.local/?hub.mode=subscribe&hub.verify_token=fake-verify-test&hub.challenge=123');
  assert.equal(await (await handler(request)).text(), '123');
  assert.equal((await handler(signed(payload(), 'wrong'))).status, 401);
  delete process.env.META_APP_SECRET; assert.equal((await handler(signed(payload()))).status, 503);
  assert.equal((await repo.listConversations()).length, 0);
});
test('webhook rejeita JSON inválido, número diferente e corpo grande', async () => {
  const { repo } = fixture(); const handler = webhook({ repository: repo });
  assert.equal((await handler(signed('{'))).status, 400);
  const wrong = payload(); wrong.entry[0].changes[0].value.metadata.phone_number_id = '999';
  assert.equal((await handler(signed(wrong))).status, 403);
  assert.equal((await handler(signed('a'.repeat(262145)))).status, 413);
});
test('webhook responde uma vez, sem duplicar contexto ou reenvio', async () => {
  const { repo } = fixture(); let ai = 0; let wa = 0;
  const handler = webhook({ repository: repo, fetchImpl: async (url, options) => {
    if (url.includes('openai')) { ai++; assert.equal((JSON.parse(options.body).input.match(/Quero 500 cartões/g) || []).length, 1); return aiResponse(); }
    wa++; return waResponse();
  } });
  assert.equal((await handler(signed(payload()))).status, 200); assert.equal((await handler(signed(payload()))).status, 200);
  assert.equal(ai, 1); assert.equal(wa, 1); assert.equal((await repo.getConversation(number)).messages.length, 2);
});
test('webhook respeita modo humano e registra mídia sem fingir lê-la', async () => {
  const { repo } = fixture(); await repo.appendMessage(number, { id: 'a', role: 'user', text: 'Oi' });
  await repo.updateConversation(number, c => { c.mode = 'human'; });
  const handler = webhook({ repository: repo });
  assert.equal((await handler(signed(payload()))).status, 200);
  assert.equal((await handler(signed(payload('media', 'image')))).status, 200);
  assert.match((await repo.getConversation(number)).messages.at(-1).text, /image recebido/);
});
test('falha na IA permite retry sem duplicar mensagem recebida', async () => {
  const { repo } = fixture(); let ai = 0;
  const handler = webhook({ repository: repo, fetchImpl: async url => {
    if (url.includes('openai')) return ++ai === 1 ? Response.json({}, { status: 500 }) : aiResponse(); return waResponse();
  } });
  assert.equal((await handler(signed(payload()))).status, 502); assert.equal((await handler(signed(payload()))).status, 200);
  assert.equal((await repo.getConversation(number)).messages.filter(m => m.role === 'user').length, 1);
});
test('rejeição explícita do WhatsApp permite retry usando resposta já gerada', async () => {
  const { repo } = fixture(); let ai = 0; let wa = 0;
  const handler = webhook({ repository: repo, fetchImpl: async url => {
    if (url.includes('openai')) { ai++; return aiResponse(); } return ++wa === 1 ? Response.json({}, { status: 500 }) : waResponse();
  } });
  assert.equal((await handler(signed(payload()))).status, 502); assert.equal((await handler(signed(payload()))).status, 200);
  assert.equal(ai, 1); assert.equal(wa, 2);
});
test('resultado incerto de envio não causa reenvio automático e avisa painel', async () => {
  const { repo } = fixture(); let wa = 0;
  const handler = webhook({ repository: repo, fetchImpl: async url => { if (url.includes('openai')) return aiResponse(); wa++; throw new Error('rede indisponível'); } });
  assert.equal((await handler(signed(payload()))).status, 200); assert.equal((await handler(signed(payload()))).status, 200);
  assert.equal(wa, 1); assert.equal((await repo.getEvent('wamid.test')).status, 'uncertain');
  assert.match((await repo.getConversation(number)).deliveryWarning, /envio não confirmado/);
});
test('evento de status não dispara resposta ao cliente', async () => {
  const { repo } = fixture(); const handler = webhook({ repository: repo });
  const value = payload(); delete value.entry[0].changes[0].value.messages;
  assert.equal((await handler(signed(value))).status, 200); assert.equal((await repo.listConversations()).length, 0);
});

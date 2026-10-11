const { timingSafeEqual } = require('node:crypto');

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') {
    super(message); this.status = status; this.code = code;
  }
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) };
}
function response(status, body) {
  const result = json(status, body);
  return new Response(result.body, { status, headers: result.headers });
}
function header(event, name) {
  return Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || '';
}
function equalSecret(got, expected) {
  if (typeof got !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(got); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function panelAuth(got) {
  if (!process.env.PANEL_ACCESS_KEY) throw new HttpError(503, 'Acesso ao painel não configurado.', 'PANEL_NOT_CONFIGURED');
  if (!equalSecret(got, process.env.PANEL_ACCESS_KEY)) throw new HttpError(401, 'Acesso não autorizado.', 'UNAUTHORIZED');
}
function parseJson(raw, maxBytes = 65536) {
  if (Buffer.byteLength(raw || '', 'utf8') > maxBytes) throw new HttpError(413, 'Dados enviados excedem o limite.', 'BODY_TOO_LARGE');
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON inválido.', 'INVALID_JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Objeto JSON obrigatório.', 'INVALID_BODY');
  return body;
}
function eventJson(event, maxBytes) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  return parseJson(raw, maxBytes);
}
async function requestJson(req, maxBytes = 65536) {
  return parseJson(await requestText(req, maxBytes), maxBytes);
}
async function requestText(req, maxBytes) {
  if (!req.body) return '';
  const reader = req.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, 'Dados enviados excedem o limite.', 'BODY_TOO_LARGE'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}
function text(value, max, label, required = true) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new HttpError(400, `${label} inválido.`, 'INVALID_FIELD');
  }
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new HttpError(400, `${label} inválido ou muito longo.`, 'INVALID_FIELD');
  return result;
}
function phone(value) {
  const result = text(value, 40, 'Telefone').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(result)) throw new HttpError(400, 'Telefone inválido.', 'INVALID_PHONE');
  return result;
}
function publicOrigin(event) {
  const allowed = process.env.PUBLIC_SITE_ORIGIN || 'https://atendimento-idy.netlify.app';
  if (header(event, 'origin') !== allowed) throw new HttpError(403, 'Origem não permitida.', 'ORIGIN_DENIED');
}
function errorResult(error) {
  // Nunca devolver mensagens arbitrárias do provedor, tokens ou detalhes internos.
  return { status: error instanceof HttpError ? error.status : 500, body: { ok: false, error: error instanceof HttpError ? error.message : 'Falha interna. Tente novamente.', code: error instanceof HttpError ? error.code : 'INTERNAL_ERROR' } };
}
async function fetchJson(url, options, { fetchImpl = globalThis.fetch, timeout = 20000, service = 'Serviço externo' } = {}) {
  let result;
  try { result = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeout) }); }
  catch (error) {
    const timedOut = ['TimeoutError', 'AbortError'].includes(error?.name);
    throw new HttpError(timedOut ? 504 : 502, `${service} temporariamente indisponível.`, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK');
  }
  let data;
  try { data = await result.json(); } catch { throw new HttpError(502, `${service} retornou uma resposta inválida.`, 'UPSTREAM_INVALID'); }
  if (!result.ok) throw new HttpError(result.status === 429 ? 429 : 502, `${service} não conseguiu concluir a operação.`, 'UPSTREAM_REJECTED');
  return data;
}
module.exports = { HttpError, json, response, header, equalSecret, panelAuth, parseJson, eventJson, requestJson, requestText, text, phone, publicOrigin, errorResult, fetchJson };

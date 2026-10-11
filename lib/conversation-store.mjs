import { randomUUID, createHash } from 'node:crypto';
import http from './http.cjs';
const { HttpError, phone: normalizePhone } = http;

export function createRepository(store) {
  const key = phone => `conv:${normalizePhone(phone)}`;
  const read = blobKey => store.getWithMetadata(blobKey, { type: 'json', consistency: 'strong' });
  async function mutate(blobKey, fn) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const current = await read(blobKey);
      const value = fn(current ? structuredClone(current.data) : null);
      const result = await store.setJSON(blobKey, value, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
      if (result.modified) return value;
    }
    throw new HttpError(503, 'Atendimento ocupado. Tente novamente.', 'STORE_CONFLICT');
  }
  async function getConversation(phone) { return (await read(key(phone)))?.data || null; }
  async function updateConversation(phone, update, name = 'Cliente', create = false) {
    const normalized = normalizePhone(phone);
    return mutate(key(phone), conv => {
      if (!conv && !create) throw new HttpError(404, 'Conversa não encontrada.', 'CONVERSATION_NOT_FOUND');
      const now = new Date().toISOString();
      conv ||= { phone: normalized, name, mode: 'ai', createdAt: now, messages: [] };
      conv.phone = normalized;
      if (name && (!conv.name || conv.name === 'Cliente')) conv.name = name;
      update(conv); conv.updatedAt = now; return conv;
    });
  }
  async function appendMessage(phone, message, name = 'Cliente') {
    const id = message.id || randomUUID();
    return updateConversation(phone, conv => {
      conv.messages = Array.isArray(conv.messages) ? conv.messages : [];
      if (!conv.messages.some(m => m.id === id)) conv.messages.push({ ...message, id, text: String(message.text || ''), at: message.at || new Date().toISOString(), type: message.type || 'text' });
      conv.messages = conv.messages.slice(-120);
    }, name, true);
  }
  async function listConversations() {
    const { blobs } = await store.list({ prefix: 'conv:' });
    const out = [];
    for (const blob of blobs || []) { const current = await read(blob.key); if (current?.data) out.push(current.data); }
    return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }
  const eventKey = id => `event:${createHash('sha256').update(id).digest('hex')}`;
  async function getEvent(id) { return (await read(eventKey(id)))?.data || null; }
  async function saveEvent(id, value) { return mutate(eventKey(id), old => ({ ...old, ...value, updatedAt: new Date().toISOString() })); }
  async function withPhoneLease(phone, work) {
    const blobKey = `lease:${normalizePhone(phone)}`; const owner = randomUUID();
    await mutate(blobKey, old => {
      if (old?.expiresAt > Date.now()) throw new HttpError(503, 'Atendimento ocupado. Tente novamente.', 'CONVERSATION_BUSY');
      return { owner, expiresAt: Date.now() + 90000 };
    });
    try { return await work(); }
    finally { await mutate(blobKey, old => old?.owner === owner ? { owner, expiresAt: 0 } : old); }
  }
  return { getConversation, updateConversation, appendMessage, listConversations, getEvent, saveEvent, withPhoneLease };
}
let repository;
export async function getRepository() {
  if (!repository) {
    const { getStore } = await import('@netlify/blobs');
    repository = createRepository(getStore(process.env.CONVERSATION_STORE || 'idy-conversations'));
  }
  return repository;
}

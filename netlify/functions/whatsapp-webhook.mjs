import { createHmac } from 'node:crypto';
import { getRepository } from '../../lib/conversation-store.mjs';
import http from '../../lib/http.cjs';
import services from '../../lib/services.cjs';
import prompts from '../../lib/prompts.json' with { type: 'json' };
const { HttpError, response, equalSecret, requestText, parseJson, phone, text, errorResult } = http;
export function createHandler({ repository, fetchImpl } = {}) {
  return async function handler(req) {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const verified = url.searchParams.get('hub.mode') === 'subscribe' && equalSecret(url.searchParams.get('hub.verify_token'), process.env.WHATSAPP_VERIFY_TOKEN);
      return new Response(verified ? url.searchParams.get('hub.challenge') || '' : 'Verification failed', { status: verified ? 200 : 403, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
    if (req.method !== 'POST') return response(405, { error: 'Método não permitido' });
    try {
      if (!process.env.META_APP_SECRET) throw new HttpError(503, 'Webhook não configurado.', 'WEBHOOK_NOT_CONFIGURED');
      const raw = await requestText(req, 262144);
      const expected = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex');
      if (!equalSecret(req.headers.get('x-hub-signature-256'), expected)) throw new HttpError(401, 'Assinatura inválida.', 'INVALID_SIGNATURE');
      const payload = parseJson(raw, 262144);
      if (payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) throw new HttpError(400, 'Evento de WhatsApp inválido.', 'INVALID_EVENT');
      const repo = repository || await getRepository();
      for (const entry of payload.entry) {
        if (!Array.isArray(entry.changes)) throw new HttpError(400, 'Evento de WhatsApp inválido.', 'INVALID_EVENT');
        for (const change of entry.changes) {
          const value = change.value || {};
          if (change.field !== 'messages' || !value.messages?.length) continue;
          if (!Array.isArray(value.messages) || value.messages.length > 20) throw new HttpError(400, 'Lote de mensagens inválido.', 'INVALID_EVENT');
          if (!process.env.WHATSAPP_PHONE_NUMBER_ID || value.metadata?.phone_number_id !== process.env.WHATSAPP_PHONE_NUMBER_ID) throw new HttpError(403, 'Número de atendimento não autorizado.', 'WRONG_PHONE_NUMBER');
          for (const message of value.messages) {
            const from = phone(message.from); const id = text(message.id, 200, 'Identificador');
            const contact = (value.contacts || []).find(c => c.wa_id === message.from);
            const name = typeof contact?.profile?.name === 'string' ? contact.profile.name.slice(0, 120) : 'Cliente';
            const incoming = message.type === 'text' ? text(message.text?.body, 4096, 'Mensagem') : `[${String(message.type || 'arquivo').slice(0, 30)} recebido pelo WhatsApp]`;
            await repo.withPhoneLease(from, async () => {
              let event = await repo.getEvent(id);
              if (event?.status === 'done' || event?.status === 'uncertain') return;
              if (event?.status === 'sending') {
                await repo.saveEvent(id, { status: 'uncertain' });
                await repo.updateConversation(from, c => { c.deliveryWarning = 'Há envio não confirmado. Confira no WhatsApp antes de reenviar.'; });
                return;
              }
              const milliseconds = Number(message.timestamp) * 1000;
              const timestamp = Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds < 8640000000000000 ? new Date(milliseconds).toISOString() : new Date().toISOString();
              await repo.appendMessage(from, { id, role: 'user', text: incoming, at: timestamp, type: message.type || 'text' }, name);
              const conv = await repo.getConversation(from);
              if (conv.mode === 'human' || message.type !== 'text') { await repo.saveEvent(id, { status: 'done' }); return; }
              if (!event?.reply) {
                const transcript = conv.messages.slice(-14).map(m => `${m.role === 'user' ? 'CLIENTE' : m.role === 'human' ? 'ATENDENTE' : 'IA'}: ${m.text}`).join('\n');
                event = await repo.saveEvent(id, { status: 'ready', reply: await services.generateReply(prompts.whatsapp, transcript, fetchImpl, 15000) });
              }
              await repo.saveEvent(id, { status: 'sending' });
              try { await services.sendWhatsAppText(from, event.reply, fetchImpl); }
              catch (error) {
                const uncertain = ['UPSTREAM_NETWORK', 'UPSTREAM_TIMEOUT', 'UPSTREAM_INVALID', 'WHATSAPP_UNCONFIRMED'].includes(error.code);
                await repo.saveEvent(id, { status: uncertain ? 'uncertain' : 'ready' });
                if (uncertain) {
                  await repo.updateConversation(from, c => { c.deliveryWarning = 'Há envio não confirmado. Confira no WhatsApp antes de reenviar.'; }); return;
                }
                throw error;
              }
              await repo.appendMessage(from, { id: `${id}:reply`, role: 'assistant', text: event.reply }, name);
              await repo.saveEvent(id, { status: 'done' });
            });
          }
        }
      }
      return response(200, { received: true });
    } catch (error) { const result = errorResult(error); return response(result.status, result.body); }
  };
}
export default createHandler();

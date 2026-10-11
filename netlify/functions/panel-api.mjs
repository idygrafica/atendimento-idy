import { randomUUID } from 'node:crypto';
import { getRepository } from '../../lib/conversation-store.mjs';
import http from '../../lib/http.cjs';
import services from '../../lib/services.cjs';
const { HttpError, response, panelAuth, requestJson, phone, text, errorResult } = http;
export function createHandler({ repository, fetchImpl } = {}) {
  return async function handler(req) {
    try {
      panelAuth(req.headers.get('x-panel-key'));
      if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'Método não permitido', 'METHOD_NOT_ALLOWED');
      const repo = repository || await getRepository(); const url = new URL(req.url);
      if (req.method === 'GET') {
        const selected = url.searchParams.get('phone');
        if (selected) return response(200, { ok: true, conversation: await repo.getConversation(phone(selected)) });
        const list = await repo.listConversations();
        return response(200, { ok: true, conversations: list.map(c => ({ phone: c.phone, name: c.name || 'Cliente', mode: c.mode || 'ai', updatedAt: c.updatedAt, lastMessage: c.messages?.at(-1) || null, count: c.messages?.length || 0 })) });
      }
      const body = await requestJson(req); const selected = phone(body.phone);
      if (!['set_mode', 'send_message'].includes(body.action)) throw new HttpError(400, 'Ação inválida.', 'INVALID_ACTION');
      if (body.action === 'set_mode' && !['ai', 'human'].includes(body.mode)) throw new HttpError(400, 'Modo inválido.', 'INVALID_MODE');
      const message = body.action === 'send_message' ? text(body.text, 4096, 'Mensagem') : '';
      return await repo.withPhoneLease(selected, async () => {
        if (!await repo.getConversation(selected)) throw new HttpError(404, 'Conversa não encontrada.', 'CONVERSATION_NOT_FOUND');
        if (body.action === 'set_mode') {
          await repo.updateConversation(selected, c => { c.mode = body.mode; });
          return response(200, { ok: true, mode: body.mode });
        }
        await repo.updateConversation(selected, c => { c.mode = 'human'; });
        await services.sendWhatsAppText(selected, message, fetchImpl);
        await repo.appendMessage(selected, { id: `manual-${randomUUID()}`, role: 'human', text: message });
        return response(200, { ok: true });
      });
    } catch (error) { const result = errorResult(error); return response(result.status, result.body); }
  };
}
export default createHandler();

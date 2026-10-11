const { HttpError, json, eventJson, text, publicOrigin, errorResult } = require('../../lib/http.cjs');
const { generateReply } = require('../../lib/services.cjs');
const prompts = require('../../lib/prompts.json');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido' });
  try {
    publicOrigin(event);
    const body = eventJson(event);
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 120) throw new HttpError(400, 'Histórico de mensagens inválido.', 'INVALID_MESSAGES');
    const messages = body.messages.slice(-12).map(message => {
      if (!message || !['user', 'assistant'].includes(message.role)) throw new HttpError(400, 'Papel da mensagem inválido.', 'INVALID_ROLE');
      return { role: message.role, content: text(message.content, 4000, 'Mensagem') };
    });
    const transcript = messages.map(m => `${m.role === 'assistant' ? 'ATENDENTE' : 'CLIENTE'}: ${m.content}`).join('\n');
    return json(200, { answer: await generateReply(prompts.chat, transcript) });
  } catch (error) { const result = errorResult(error); return json(result.status, result.body); }
};

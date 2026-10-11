const { HttpError, fetchJson } = require('./http.cjs');
function openAIKey() {
  if (!process.env.OPENAI_API_KEY) throw new HttpError(503, 'Atendimento com IA não configurado.', 'AI_NOT_CONFIGURED');
  return process.env.OPENAI_API_KEY;
}
function answerText(data) {
  const answer = data.output_text || (Array.isArray(data.output) ? data.output.flatMap(x => x.content || []).filter(c => c.type === 'output_text' || typeof c.text === 'string').map(c => c.text || '').join('\n').trim() : '');
  if (!answer || typeof answer !== 'string') throw new HttpError(502, 'A IA não retornou uma resposta. Tente novamente.', 'AI_EMPTY_RESPONSE');
  return answer;
}
async function generateReply(instructions, input, fetchImpl, timeout = 20000) {
  const data = await fetchJson('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${openAIKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', instructions, input, max_output_tokens: 1000 }),
  }, { fetchImpl, timeout, service: 'Atendimento com IA' });
  return answerText(data);
}
async function sendWhatsApp(payload, fetchImpl) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_VERSION || 'v26.0';
  if (!token || !id) throw new HttpError(503, 'WhatsApp não configurado.', 'WHATSAPP_NOT_CONFIGURED');
  if (!/^\d+$/.test(id) || !/^v\d+\.\d+$/.test(version)) throw new HttpError(503, 'Configuração do WhatsApp inválida.', 'WHATSAPP_CONFIG_INVALID');
  const data = await fetchJson(`https://graph.facebook.com/${version}/${id}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
  }, { fetchImpl, timeout: 8000, service: 'WhatsApp' });
  if (!data.messages?.[0]?.id) throw new HttpError(502, 'WhatsApp não confirmou o envio.', 'WHATSAPP_UNCONFIRMED');
  return data;
}
function sendWhatsAppText(to, body, fetchImpl) {
  if (body.length > 4096) throw new HttpError(400, 'Mensagem excede o limite do WhatsApp.', 'MESSAGE_TOO_LONG');
  return sendWhatsApp({ to, type: 'text', text: { preview_url: false, body } }, fetchImpl);
}
module.exports = { openAIKey, answerText, generateReply, sendWhatsApp, sendWhatsAppText };

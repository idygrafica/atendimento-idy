const { HttpError, json, header, panelAuth, eventJson, text, errorResult, fetchJson } = require('../../lib/http.cjs');
const { openAIKey } = require('../../lib/services.cjs');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Método não permitido' });
  try {
    panelAuth(header(event, 'x-panel-key'));
    const body = eventJson(event);
    if (!['logo', 'facade'].includes(body.type)) throw new HttpError(400, 'Tipo de prévia inválido.', 'INVALID_PREVIEW_TYPE');
    const brief = text(body.brief, 4000, 'Briefing');
    if (brief.length < 8) throw new HttpError(400, 'Descreva um pouco melhor o que deve ser criado.', 'BRIEF_TOO_SHORT');
    const prompt = body.type === 'facade'
      ? `Crie uma prévia visual conceitual de fachada comercial para aprovação de cliente. Use o briefing a seguir: ${brief}. Aparência profissional, legível, realista, vista frontal/levemente em perspectiva, sem afirmar medidas técnicas. Trate como mockup de aprovação, não arquivo final de produção.`
      : `Crie uma proposta visual de logotipo original e profissional com base neste briefing: ${brief}. Composição limpa, memorável, adequada para impressão e comunicação visual. Apresente como conceito de marca em fundo neutro. Evite mockups excessivos; destaque o símbolo e a tipografia.`;
    const data = await fetchJson('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${openAIKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size: '1024x1024' }),
    }, { timeout: 50000, service: 'Geração de prévias' });
    const item = data.data?.[0] || {}; let image;
    if (typeof item.b64_json === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json)) image = `data:image/png;base64,${item.b64_json}`;
    else if (typeof item.url === 'string') { try { if (new URL(item.url).protocol === 'https:') image = item.url; } catch {} }
    if (!image) throw new HttpError(502, 'A API não retornou uma imagem válida.', 'IMAGE_INVALID');
    if (image.length > 4000000) throw new HttpError(502, 'Prévia grande demais. Será necessário armazenamento externo.', 'IMAGE_TOO_LARGE');
    return json(200, { ok: true, image, previewOnly: true });
  } catch (error) { const result = errorResult(error); return json(result.status, result.body); }
};

const { json, eventJson, text, phone, publicOrigin, errorResult } = require('../../lib/http.cjs');
const { sendWhatsApp, sendWhatsAppText } = require('../../lib/services.cjs');
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Método não permitido' });
  try {
    publicOrigin(event);
    const body = eventJson(event, 100000);
    const nome = text(body.nome, 120, 'Nome'); const whatsapp = phone(body.whatsapp);
    const resumo = text(body.resumo, 90000, 'Resumo', false).slice(0, 2600);
    const arquivo = text(body.arquivo, 180, 'Arquivo', false);
    const to = phone(process.env.IDY_NOTIFICATION_WHATSAPP || '5551981687562');
    const templateName = process.env.WHATSAPP_LEAD_TEMPLATE_NAME;
    if (templateName) {
      await sendWhatsApp({ to, type: 'template', template: {
        name: templateName, language: { code: process.env.WHATSAPP_LEAD_TEMPLATE_LANGUAGE || 'pt_BR' },
        components: [{ type: 'body', parameters: [
          { type: 'text', text: nome }, { type: 'text', text: whatsapp },
          { type: 'text', text: (arquivo ? `${resumo}\nArquivo: ${arquivo}` : resumo).slice(0, 900) || '-' },
        ] }],
      } });
    } else {
      await sendWhatsAppText(to, ['🔔 NOVO ATENDIMENTO — IDY GRÁFICA', `Cliente: ${nome}`, `WhatsApp: ${whatsapp}`, arquivo ? `Arquivo: ${arquivo}` : '', 'Resumo:', resumo || 'Atendimento sem histórico.'].filter(Boolean).join('\n'));
    }
    return json(200, { ok: true });
  } catch (error) { const result = errorResult(error); return json(result.status, result.body); }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function cleanText(value, max = 3000) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

async function sendFreeform({ token, phoneNumberId, graphVersion, to, body }) {
  const r = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data?.error?.message || `WhatsApp HTTP ${r.status}`);
    err.meta = data;
    throw err;
  }
  return data;
}

async function sendTemplate({ token, phoneNumberId, graphVersion, to, templateName, nome, whatsapp, resumo }) {
  const r = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: process.env.WHATSAPP_LEAD_TEMPLATE_LANGUAGE || 'pt_BR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: cleanText(nome, 120) || '-' },
            { type: 'text', text: cleanText(whatsapp, 80) || '-' },
            { type: 'text', text: cleanText(resumo, 900) || '-' },
          ],
        }],
      },
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `WhatsApp template HTTP ${r.status}`);
  return data;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Método não permitido' });

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.META_GRAPH_VERSION || 'v26.0';
  const to = String(process.env.IDY_NOTIFICATION_WHATSAPP || '5551981687562').replace(/\D/g, '');

  if (!token || !phoneNumberId) {
    return json(500, { ok: false, error: 'WhatsApp da IDY ainda não está configurado na Netlify.' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const nome = cleanText(body.nome, 120);
    const whatsapp = cleanText(body.whatsapp, 80);
    const resumo = cleanText(body.resumo, 2600);
    const arquivo = cleanText(body.arquivo, 180);

    if (!nome || !whatsapp) return json(400, { ok: false, error: 'Nome e WhatsApp são obrigatórios.' });

    const msg = [
      '🔔 NOVO ATENDIMENTO — IDY GRÁFICA',
      '',
      `Cliente: ${nome}`,
      `WhatsApp: ${whatsapp}`,
      arquivo ? `Arquivo: ${arquivo}` : '',
      '',
      'Resumo:',
      resumo || 'Atendimento sem histórico.'
    ].filter(Boolean).join('\n');

    const templateName = cleanText(process.env.WHATSAPP_LEAD_TEMPLATE_NAME, 160);

    // Se houver template aprovado configurado, ele é o caminho permanente e funciona
    // mesmo fora da janela de 24 horas. Sem template, tenta texto livre; isso funciona
    // quando o número interno da IDY possui uma conversa aberta com o número do robô.
    if (templateName) {
      await sendTemplate({ token, phoneNumberId, graphVersion, to, templateName, nome, whatsapp, resumo: arquivo ? `${resumo}\nArquivo: ${arquivo}` : resumo });
      console.log('IDY_LEAD_NOTIFICATION_TEMPLATE_SENT', { to, nome });
    } else {
      await sendFreeform({ token, phoneNumberId, graphVersion, to, body: msg });
      console.log('IDY_LEAD_NOTIFICATION_TEXT_SENT', { to, nome });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error('notify-idy-whatsapp error:', err);
    return json(200, { ok: false, error: err.message || 'Falha ao enviar aviso para o WhatsApp da IDY.' });
  }
};

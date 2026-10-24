const defaultTable = require('../config/print-prices.json');
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100).replace(/\u00a0/g, ' ');
const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, cinquenta: 50, cem: 100, mil: 1000 };
const numberPattern = '(?:[-+]?\\d[\\d.,]*|'+Object.keys(words).join('|')+')';
function quantity(value) {
  value = value.replace(/[.,]+$/, '');
  const n = words[value] ?? (/^\+?\d+(?:\.\d{3})*$/.test(value) ? Number(value.replace(/\./g, '')) : NaN);
  return Number.isSafeInteger(n) && n > 0 && n <= 1000000 ? n : null;
}
function isHumanRequest(text) {
  const t = normalize(text).trim();
  if (/\b(?:nao|nem)\b.{0,35}\b(?:human[oa]|atendente|pessoa|alguem|encaminh|transfer)/.test(t) || /\b(?:depois|ainda nao)\b/.test(t)) return false;
  return /^(?:human[oa]|atendente|atendimento humano)[.!\s]*$/.test(t) ||
    /\b(?:quero|preciso|gostaria|pode|posso|me|falar|conversar|cham[ae])\b.{0,60}\b(?:falar|conversar|atendimento|encaminh\w*|transfer\w*|pass\w*)\b.{0,35}\b(?:human[oa]|atendente|pessoa|alguem|equipe)\b/.test(t) ||
    /\b(?:quero|preciso(?: de)?|gostaria(?: de)?)\s+(?:um |uma |de )?(?:human[oa]|atendente|atendimento humano)\b/.test(t);
}
function readPrintContext(messages) {
  let state = { active: false, paper: 'sulfite-comum', grammage: null };
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const t = normalize(message.content);
    if (/\b(?:novo pedido|outro pedido|novo orcamento)\b/.test(t)) state = { active: false, paper: 'sulfite-comum', grammage: null };
    if (/\b(?:cartoes?|cartao|fachada|banner|camiseta|bone|caneca|criacao de site|logotipo|livros?|catalogos?|panfletos?|folders?|adesivos?|etiquetas?|comandas?|blocos?|encadernacao|apostilas?)\b/.test(t) && !/\ba[0-6]\b|\b(?:copias?|impressoes?|folhas?)\b/.test(t)) { state = { active: false, paper: 'sulfite-comum', grammage: null }; continue; }
    const formats = [...t.matchAll(/\ba([0-6])\b/g)].map(m=>'A'+m[1]);
    if (formats.length || /\b(?:copias?|impressao|impressoes|imprimir|sulfite|papel|gramatura|gramagem|folhas?)\b/.test(t)) state.active = true;
    if (!state.active) continue;
    if (new Set(formats).size > 1 || /\b\d+\s*(?:copias?|folhas?|impressoes?)\b.{0,40}\be\s+\d+\s*(?:copias?|folhas?|impressoes?)\b/.test(t)) state.multiple = true;
    else if (formats.length) { state.format = formats.at(-1); state.multiple = false; }
    else if (/\b(?:oficio|outro formato)\b|\b\d+(?:[.,]\d+)?\s*(?:cm|mm)?\s*x\s*\d+/.test(t)) state.format = 'PERSONALIZADO';
    const colors = [...t.matchAll(/\b(?:preto\s*(?:e|&)\s*branco|p\s*&\s*b|pb|monocromatic[oa]|colorid[oa]s?|a cores|em cores)\b/g)];
    if (colors.length) state.color = /colorid|cores/.test(colors.at(-1)[0]) ? 'color' : 'mono';
    if (/\bnao\s+(?:e\s+)?colorid/.test(t)) state.color = 'mono';
    const faces = [...t.matchAll(/\b(?:frente\s*(?:e|&|\/)\s*verso|duplex|dupla face|duas faces|2 faces|somente (?:a )?frente|so (?:na )?frente|apenas (?:a )?frente|uma face|1 face|frente unica|frente)\b/g)];
    if (faces.length) state.faces = /verso|duplex|dupla|duas|2 faces/.test(faces.at(-1)[0]) ? 2 : 1;
    const negativeFace = [...t.matchAll(/\bnao (?:quero |e |vai ser )?(?:frente e verso|somente frente|so frente)\b/g)].at(-1);
    if (negativeFace && (!faces.length || negativeFace.index+negativeFace[0].length >= faces.at(-1).index+faces.at(-1)[0].length)) state.faces = undefined;
    if (/\b(?:papel\s+)?(?:sulfite|comum|normal|padrao)\b/.test(t)) { state.paper = 'sulfite-comum'; state.grammage = null; }
    if (/\b(?:mais grosso|mais grossa|maior gramatura|gramatura (?:superior|maior)|papel grosso|papel especial|couche|cartolina|fotografic[oa]|offset|reciclado|kraft|vegetal|adesivo|verge|opaline|papel colorid[oa]|papel cartao|papel de foto|brilho|fosco)\b/.test(t)) state.paper = 'especial';
    if (/\bnao\s+(?:quero\s+|e\s+|use\s+)?(?:papel\s+)?(?:sulfite|comum|normal|padrao)\b/.test(t)) state.paper = 'especial';
    const gsm = t.match(/\b(\d{1,4})\s*(?:g(?:\s*\/\s*m(?:2|²))?|gramas?|gsm)\b/);
    if (gsm) state.grammage = Number(gsm[1]);
    const q = t.replace(/\ba[0-6]\b/g, '');
    const noun = q.match(new RegExp('(?<![\\w.,+/\\-])('+numberPattern+')\\s*(copias?|impressoes?|folhas?|unidades?)\\b'));
    const lead = q.match(new RegExp('^(?:(?:quero|preciso(?: de)?|serao|sao|agora|mude para|quantidade(?: de)?)\\s+)?('+numberPattern+')(?=\\s*(?:[,;]|$|somente|so |apenas|frente))'));
    const match = noun || lead;
    // “Uma cópia” em uma pergunta de preço é uma referência ao unitário, não a um pedido fechado.
    if (match && !(/^(?:quanto|qual|o que custa)/.test(t.trim()) && ['uma','um'].includes(match[1]))) {
      state.quantity = quantity(match[1]); state.invalidQuantity = state.quantity === null;
      if (noun && /^folha/.test(noun[2])) state.pageAmbiguity = false;
    }
    if (/\b\d+\s*paginas?\b/.test(t) && !(noun && /^folha/.test(noun[2]))) state.pageAmbiguity = true;
    if (/\b\d+\s*(?:a|ate|ou|-)\s*\d+\s*(?:copias?|folhas?|impressoes?)/.test(t)) { state.quantity = null; state.invalidQuantity = true; }
  }
  return state;
}
function calculateQuote({ quantity: count, faces, pricePerFaceCents }) {
  if (![count, faces, pricePerFaceCents].every(Number.isSafeInteger) || count < 1 || count > 1000000 || ![1,2].includes(faces) || pricePerFaceCents < 1) throw new RangeError('Dados de cálculo inválidos.');
  const unitCents = faces * pricePerFaceCents, totalCents = count * unitCents;
  if (!Number.isSafeInteger(totalCents)) throw new RangeError('Total fora do limite.');
  return { quantity: count, faces, pricePerFaceCents, unitCents, totalCents };
}
function printReply(messages, table = defaultTable) {
  const last = messages.filter(m=>m.role==='user').at(-1)?.content || '';
  if (isHumanRequest(last)) return { answer: 'Claro. Vou encaminhar seu histórico para a equipe da IDY.', handoff: true, reason: 'human-request' };
  const state = readPrintContext(messages), t = normalize(last).trim();
  if (!state.active) return null;
  if (/\b(?:onde|endereco|horario|pagamento|pix)\b/.test(t)) return null;
  if (/^(?:obrigad[oa]|valeu|muito obrigad[oa])[.!\s]*$/.test(t)) return {answer:'Por nada! Fico à disposição.',reason:'thanks'};
  if (state.multiple) return { answer: 'Esse pedido reúne mais de um item. A equipe vai conferir cada formato e quantidade para passar o orçamento correto.', handoff: true, reason: 'multiple-items' };
  if ((state.paper !== 'sulfite-comum' || state.grammage !== null) && !(table?.prices || []).some(p=>p.paper===state.paper&&p.grammage===state.grammage)) return { answer: 'Não há preço cadastrado para esse papel ou gramatura. A equipe vai confirmar o valor, sem acréscimo automático.', handoff: true, reason: 'unregistered-price' };
  if (!state.format) return { answer: 'Qual é o formato da impressão: A3, A4 ou outro?', reason: 'missing-format' };
  const candidates = (table?.prices || []).filter(p=>p.format===state.format&&p.paper===state.paper&&p.grammage===state.grammage&&Number.isSafeInteger(p.pricePerFaceCents)&&p.pricePerFaceCents>0);
  const noPrice = () => ({ answer: state.grammage !== null || state.paper !== 'sulfite-comum' ? 'Não há preço cadastrado para esse papel ou gramatura. A equipe vai confirmar o valor, sem acréscimo automático.' : 'Não há preço cadastrado para essa impressão. A equipe vai confirmar o orçamento.', handoff: true, reason: 'unregistered-price' });
  if (!candidates.length) return noPrice();
  if (!state.color) return { answer: 'A impressão é colorida ou em preto e branco?', reason: 'missing-color' };
  const price = candidates.find(p=>p.color===state.color);
  if (!price) return noPrice();
  const unit = price.pricePerFaceCents, description = 'impressão '+state.format+' '+(state.color==='color'?'colorida':'em preto e branco')+' em papel sulfite comum';
  if (state.invalidQuantity) return { answer: 'Informe uma quantidade inteira de folhas, maior que zero e até 1.000.000.', reason: 'invalid-quantity' };
  if (state.pageAmbiguity) return { answer: 'A '+description+' custa '+money(unit)+' por face. Quantas folhas serão impressas ao todo? Preciso distinguir as folhas das páginas do arquivo.', reason: 'pages-not-sheets' };
  if (!state.quantity) return { answer: 'A '+description+' custa '+money(unit)+' por folha somente frente ou '+money(unit*2)+' frente e verso ('+money(unit)+' por face). Quantas folhas você precisa?', reason: 'missing-quantity' };
  if (!state.faces) {
    const front = calculateQuote({quantity:state.quantity,faces:1,pricePerFaceCents:unit}), duplex = calculateQuote({quantity:state.quantity,faces:2,pricePerFaceCents:unit});
    return { answer: 'Para '+state.quantity+' folhas: somente frente, '+money(front.unitCents)+' por folha e total de '+money(front.totalCents)+'; frente e verso, '+money(duplex.unitCents)+' por folha e total de '+money(duplex.totalCents)+'. Qual das duas opções você prefere?', reason: 'missing-faces', options:[front,duplex] };
  }
  const quote = calculateQuote({quantity:state.quantity,faces:state.faces,pricePerFaceCents:unit});
  const previousAnswer = messages.slice(0,-1).filter(m=>m.role==='assistant').at(-1)?.content || '';
  const confirmsFile = /ja tem (?:o )?arquivo/.test(normalize(previousAnswer)) && /^(?:sim|tenho|ja tenho)(?:[.!\s]|$)/.test(t);
  const hasFile = confirmsFile || messages.some(m=>m.role==='user'&&/\b(?:ja tenho (?:o |um |a )?(?:arquivo|arte|pdf)|arquivo selecionado|selecionou uma arte|anexei|enviei (?:o )?arquivo)\b/.test(normalize(m.content)));
  const fileAsked = messages.some(m=>m.role==='assistant'&&/ja tem (?:o )?arquivo/.test(normalize(m.content)));
  if (confirmsFile || (hasFile && /^(?:sim[, ]+)?(?:ja (?:tenho|anexei|enviei)|anexei|enviei)\b/.test(t) && !/\ba[0-6]\b|\b\d+\s*(?:copias?|folhas?)/.test(t))) return { answer: 'Anexe seu PDF, PNG ou JPG pelo botão de clipe. A equipe conferirá o arquivo antes da impressão.', reason: 'file-instructions', quote };
  return { answer: state.quantity+' '+(state.quantity===1?'folha':'folhas')+' '+state.format+' '+(state.color==='color'?(state.quantity===1?'colorida':'coloridas'):'em preto e branco')+', '+(state.faces===2?'frente e verso':'somente frente')+', em papel sulfite comum: '+money(quote.unitCents)+' por folha ('+money(unit)+' por face). Total: '+money(quote.totalCents)+'.'+(!hasFile&&!fileAsked?' Você já tem o arquivo para impressão?':''), reason:'quote', quote };
}
module.exports = { calculateQuote, isHumanRequest, readPrintContext, printReply };

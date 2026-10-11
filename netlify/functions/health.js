const { json } = require('../../lib/http.cjs');
exports.handler = async function(event) {
  if (event?.httpMethod && event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido' });
  return json(200, { status: 'netlify-function-ok', hasKey: Boolean(process.env.OPENAI_API_KEY) });
};

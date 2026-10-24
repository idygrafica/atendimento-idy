exports.handler = async function() {
  return {
    statusCode: 200,
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ status: 'netlify-function-ok', hasKey: Boolean(process.env.OPENAI_API_KEY) })
  };
};

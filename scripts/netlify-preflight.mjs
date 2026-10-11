import { mkdir, writeFile, appendFile } from 'node:fs/promises';

const token = process.env.NETLIFY_AUTH_TOKEN;
const siteID = process.env.NETLIFY_SITE_ID;
const report = {
  project: 'atendimento-idy',
  source_commit: process.env.GITHUB_SHA || null,
  branch: 'recuperacao-atendimento-ia',
  credential_presence: { NETLIFY_AUTH_TOKEN: Boolean(token), NETLIFY_SITE_ID: Boolean(siteID) },
  checks: [],
  previous_deploy: null,
  result: 'blocked',
  deployment: 'not executed',
  configuration_changes: 'not executed',
  application_tests: 'not repeated'
};
class PreparationError extends Error {}
async function get(path) {
  let response;
  try {
    response = await fetch(`https://api.netlify.com/api/v1${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new PreparationError('Não foi possível consultar a API Netlify pela rede do runner.');
  }
  if (!response.ok) throw new PreparationError(`Consulta Netlify recusada (HTTP ${response.status}). Conferir token e acesso ao projeto.`);
  try { return await response.json(); }
  catch { throw new PreparationError('A API Netlify retornou dados inválidos.'); }
}
try {
  if (process.env.GITHUB_REF !== 'refs/heads/recuperacao-atendimento-ia') throw new PreparationError('Execução permitida somente na branch recuperacao-atendimento-ia.');
  const missing = Object.entries(report.credential_presence).filter(([, configured]) => !configured).map(([name]) => name);
  if (missing.length) throw new PreparationError(`Configurações ausentes ou inacessíveis a este workflow: ${missing.join(', ')}. Cadastrar em GitHub Settings > Secrets and variables > Actions.`);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(siteID)) throw new PreparationError('NETLIFY_SITE_ID precisa ser o Project ID UUID do projeto existente atendimento-idy.');
  const site = await get(`/sites/${encodeURIComponent(siteID)}`);
  if (site.id !== siteID || site.name !== 'atendimento-idy') throw new PreparationError('O token/Project ID não identificou atendimento-idy. Publicação bloqueada para preservar os outros projetos.');
  report.checks.push('Token permite leitura do projeto correto.');
  if (site.build_settings?.repo_url) throw new PreparationError('O projeto agora apresenta repositório vinculado. Conferir publicação automática antes de continuar.');
  report.checks.push('Projeto sem repositório vinculado na resposta Netlify.');
  const previousID = site.published_deploy?.id;
  if (!previousID || !/^[a-f0-9]{24}$/i.test(previousID)) throw new PreparationError('A API não identificou um deploy publicado recuperável. Registrar o deploy anterior antes de publicar.');
  const previous = await get(`/deploys/${previousID}`);
  if (previous.site_id !== siteID || previous.state !== 'ready') throw new PreparationError('O deploy anterior não está disponível no projeto esperado.');
  report.previous_deploy = { id: previousID, project: 'atendimento-idy', state: 'ready', url: `https://${previousID}--atendimento-idy.netlify.app` };
  report.checks.push('Deploy publicado anterior identificado para restauração.');
  report.checks.push('META_APP_SECRET cadastrada no Netlify conforme confirmação do proprietário; valores não consultados.');
  report.result = 'project_read_access_confirmed';
  report.pending = ['Confirmar demais configurações Production/Functions na conta Netlify.', 'Obter autorização explícita para publicar.', 'Reconfirmar e registrar deploy anterior imediatamente antes da publicação.'];
} catch (error) {
  // Nunca imprimir respostas da API, credenciais, valores de variáveis ou erros arbitrários.
  report.blocker = error instanceof PreparationError ? error.message : 'Falha interna na preparação. Nenhuma publicação foi executada.';
  process.exitCode = 1;
}
await mkdir('.netlify', { recursive: true });
await writeFile('.netlify/publication-preparation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `# Preparação de atendimento-idy\n\nResultado: ${report.result}.\n\n${report.blocker || report.checks.join('\n\n')}\n\nNenhum deploy executado; testes anteriores não repetidos.\n`);
}

# Orçamento A3 e atendimento humano — proposta sem publicação

A base é `codex/tela-inicial-atendimento`, commit `e59810a0609fb4435d55460970faf7f1d5f14dae`. A comparação de leitura dos scripts da home pública confirmou essa versão. A `main` contém somente a interface; as PRs #2 e #3, de outras melhorias de prévias, continuam separadas e não foram incorporadas aqui.

O arquivo `netlify/functions/chat.js` foi recuperado da URL pública da aplicação, cujo SHA-256 era `8c71d3ea6218164ef4528f606e295c4b3e220a9c45f7f656016a62fc1c94242d`. As regras comerciais existentes de cartões e fachadas foram preservadas. O atendimento institucional não foi alterado.

## Preços e cálculo

Editar **`config/print-prices.json`**. O único preço novo é A3 colorido, sulfite comum, `pricePerFaceCents: 300`. Uma folha somente frente custa R$ 3,00; frente e verso custa R$ 6,00. Total = folhas × faces × centavos por face. Não há desconto progressivo nem acréscimo implícito.

As propriedades de cada linha são formato (`A3`), cor (`color` ou `mono`), papel (`sulfite-comum`) e gramatura (`null` significa o sulfite comum sem gramatura especificada). Uma gramatura informada pelo cliente só poderá ter preço automático com uma linha correspondente, autorizada pelo administrador. Não se assume 75g ou 90g como cadastro existente. Não foi cadastrado preço para A4, PB ou papel especial. Não cadastrar R$ 3,20 para A4 sem autorização.

O servidor identifica os dados no histórico de mensagens do cliente e calcula em inteiros. Não depende de aritmética ou valores escritos pela IA, mesmo se uma mensagem anterior contiver um preço fictício. Pedidos com páginas de arquivo e folhas ambíguas precisam de esclarecimento; formato, papel ou gramatura sem preço seguem para humano.

## Fluxo humano e preservação

O botão de atendimento humano e respostas do endpoint com `handoff: true` usam o registro existente em Forms, com nome, e-mail, WhatsApp, histórico completo, original e proposta de arte quando disponíveis. O aviso interno existente continua sendo chamado após o registro. O texto do aviso pode ser resumido pelo endpoint já publicado; o histórico integral fica no registro da equipe. Não é preciso escrever “pode encaminhar”. A frase antiga continua aceita, mas um “não” isolado não é tratado como autorização.

As prévias, controles de criação/edição, salvamento parcial, aviso de inatividade, painel e notificações foram mantidos. Nenhuma API real de OpenAI ou Meta foi chamada nos testes; Forms e notificações foram simulados.

## Validação e teste

`node --test --test-isolation=none print-quote.test.mjs flow.test.mjs artwork.test.mjs partial-leads.test.mjs`

O workflow da branch também executa Chromium em 390 e 1440 px com o **endpoint de chat real da proposta**, substituindo somente Forms, armazenamento e avisos por serviços locais de teste. Inclui exatamente os cinco pedidos solicitados e a sequência “Quanto custa uma cópia A3 colorida?” → “Quero 3, somente frente.”. Capturas e relatório ficam no artifact `orcamento-a3-sem-publicacao`.

O empacotador oficial valida que a função `chat` leva a tabela JSON e o módulo de cálculo. Não executar `deploy-artwork.mjs` para testar esta PR: esse script anterior é de publicação e não faz parte da validação.

## Antes de uma publicação futura

Esta PR não publica, não altera credenciais e não faz merge. O teste de leitura autenticada da API Netlify respondeu HTTP 401 com a credencial existente; os arquivos necessários foram inspecionados por GET público. Uma futura publicação autorizada precisará restabelecer esse acesso, conferir o deploy então ativo e preservar todas as Functions existentes (inclusive as que não estão versionadas nesta base). O bundle novo de `chat` deve incluir `lib/print-quote.cjs` e `config/print-prices.json`. Não substituir todas as funções da conta por este checkout parcial.

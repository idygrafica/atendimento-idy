# Revisão da PR #4 — atendimento-idy

Esta aplicação é independente do site institucional. A proposta altera somente `idygrafica/atendimento-idy`. Não faz merge, deploy, envio real de WhatsApp, troca de credenciais ou alteração no painel Netlify.

## Estado e origem

A base é `codex/tela-inicial-atendimento`, commit `e59810a0609fb4435d55460970faf7f1d5f14dae`. A interface pública auditada em 24/10 corresponde a essa base. A branch configurada como produção no Netlify continua **não confirmada**: a leitura autenticada da conta e do projeto respondeu 401 novamente.

A `main` não contém o backend completo. Não mudar o destino da PR para a `main` como tentativa de resolver autenticação. O workflow anterior da base publicava via `deploy-artwork.mjs` com o mesmo token. Nesta proposta, ele passa a executar somente testes, sem segredos, e o script antigo falha imediatamente antes de qualquer chamada remota.

A integração nativa Netlify GitHub App pode dispensar esse token, mas o vínculo, a branch e os controles de publicação precisam ser consultados no projeto existente. Não foram alterados nesta entrega.

## Backend recuperado

Evidência: https://github.com/idygrafica/atendimento-idy/actions/runs/40097487653 .
Seis arquivos ausentes foram recuperados das fontes públicas e mantidos **byte a byte**. URLs, data e SHA-256 estão em `config/published-backend.json`; os testes conferem esses hashes.

| Arquivo/função | Situação |
| --- | --- |
| chat.js | Fonte pública recuperada anteriormente, com as alterações autorizadas de orçamento |
| conversation-store.mjs | Recuperado sem edição; módulo de armazenamento de painel e webhook |
| creative-preview.js | Recuperado sem edição; prévias do painel |
| health.js | Recuperado sem edição; diagnóstico de presença de configuração |
| notify-idy-whatsapp.js | Recuperado sem edição; avisos internos |
| panel-api.mjs | Recuperado sem edição; autorização, conversas e modo humano |
| whatsapp-webhook.mjs | Recuperado sem edição; contrato do WhatsApp |
| artwork.mjs | Já versionado na base publicada; prévias do chat |
| partial-lead.mjs | Já versionado; cadastro e salvamento parcial |
| idle-leads.mjs | Já versionado; cron e guarda de execução em produção preservados |

O histórico de publicação de 12/10 contém as sete funções originais e a inclusão das três últimas. O pacote de teste exige todas as **dez funções conhecidas**. Não se trata de um inventário autenticado do deploy ativo: qualquer função, Edge Function ou configuração posterior precisa ser conferida antes de publicar.

GETs públicos de 24/10: chat 405, notify-idy-whatsapp 405, panel-api 401 sem chave, whatsapp-webhook 403 sem verificação. São resultados compatíveis com as proteções presentes nas fontes. Nenhum histórico privado foi consultado e nenhum POST real foi enviado. Uma fonte pública não comprova, sozinha, igualdade com o bundle executável atual.

A dependência Blobs foi fixada em 11.1.4, versão usada nos testes anteriores, em lugar de latest. Nenhum dado foi apagado ou migrado.

## Atendimento preservado e corrigido

- Preços em `config/print-prices.json`: somente A3 colorido em sulfite comum, 300 centavos por face. Somente frente R$ 3,00 por folha; frente e verso R$ 6,00. Três frente R$ 9,00; cem frente e verso R$ 600,00.
- Total no servidor em inteiros: folhas × faces × preço por face. Sem desconto ou acréscimo automático. Outros formatos/papéis/gramaturas sem linha cadastrada seguem para humano. Não foi cadastrado A4 a R$ 3,20.
- Informações anteriores são reaproveitadas. Um “sim” à pergunta sobre o arquivo agora recebe instrução curta para anexar, sem repetir preço ou pergunta.
- O botão humano interrompe a espera por uma resposta de chat e registra histórico e anexos uma única vez.
- PDF, PNG e JPG: limite visível de 8 MB; arquivo inválido conserva a seleção válida anterior.
- O painel respeita hidden antes do login e informa falhas de atualização, modo e envio preservando texto não enviado.
- Cadastro, arquivo original, proposta de arte, avisos e agendamento foram preservados.

### Onde o histórico fica

O chat web registra contato, conversa completa, original e proposta em **Netlify Forms**, com o aviso interno existente. O salvamento parcial usa `idy-partial-leads`. O painel lista conversas de **WhatsApp** em `idy-conversations`, alimentadas pelo webhook.

Não foi inventada sincronização entre Forms e painel. O histórico do chat web não aparece automaticamente nessa lista de WhatsApp; a equipe o consulta em Forms. O armazenamento recuperado mantém sua política existente de últimas 120 mensagens por conversa do WhatsApp.

## Testes sem serviços reais

```sh
node --test --test-isolation=none print-quote.test.mjs flow.test.mjs artwork.test.mjs partial-leads.test.mjs recovered-backend.test.mjs
node price-quote.browser.mjs
node panel.browser.mjs
node verify-bundles.mjs
```

A suíte local contém 103 testes aprovados: cinco pedidos obrigatórios, cálculo, cadastro, anexos, histórico, falhas, autorização, transferência sem duplicação, recuperação das fontes e bloqueio do script antigo. A confirmação de arquivo não oculta um preço novo quando o cliente muda as faces ou pergunta novamente pelo total.

O workflow valida chat e painel em Chromium a 390/1440 px. O endpoint A3 e o backend recuperado são executados com Forms, armazenamento e provedores simulados. O empacotador oficial exige dez nomes conhecidos, APIs de runtime inferidas dos handlers, dependências de painel/webhook e o cálculo compilado.

Não há chamadas reais de OpenAI/Meta, mensagens reais, cobranças, publicações ou alterações de clientes. Relatórios e capturas: artifact `atendimento-completo-sem-publicacao`. O relatório mantém `readyForPublication: false` enquanto as conferências externas e a aprovação estiverem pendentes.

## Dados para conferir manualmente no Netlify

Consultar o projeto **atendimento-idy**, sem salvar mudanças nesta fase:

1. Project information: Project ID e ID/contexto/commit do deploy publicado.
2. Developer settings → Continuous deployment → Repository: vínculo com `idygrafica/atendimento-idy` e autorização do Netlify GitHub App.
3. Branches and deploy contexts: branch de produção e configurações de previews/branches.
4. Deploys/build settings: builds pausados, auto publicação, bloqueio do deploy e comando/diretórios de build.
5. Functions: lista completa, runtime/configuração e agendamentos, inclusive idle-leads. Conferir Edge Functions existentes.
6. Forms/Blobs: formulário atendimento-idy e campos de arquivo arte/proposta; armazenamentos existentes e retenção.
7. Conferir apenas presença e contextos das configurações OpenAI, painel, WhatsApp e notificações. **Não copiar valores de segredos.**

Comparar esse inventário ao pacote antes de publicar. Funções desconhecidas precisam ser recuperadas ou ter comportamento confirmado; não recriar por suposição.

## Liberação

**A PR ainda não está liberada para produção.** O backend conhecido foi recuperado, mas faltam confirmar deploy ativo, branch/configuração Netlify, inventário completo e aprovação do responsável.

Não executar o script legado (desativado), habilitar integrações, fazer merge ou remover `[skip netlify]` para testar acesso: isso pode publicar. O futuro caminho de publicação será preparado somente após a conferência da configuração real e autorização explícita.

# Recuperação do atendimento IDY Gráfica

## Resultado

Backend recuperado e correções preparadas localmente. Este pacote não foi integrado ao GitHub nem publicado no Netlify. O site institucional não foi modificado. Há pendências de configuração e validação externa antes de produção.

O ZIP original contém 17 arquivos. Comparado com `idygrafica/atendimento-idy`, branch `main`, commit `ef5c8c717e3f81f5cfd280b33d52944e655b7ad2`, os dez arquivos da raiz são idênticos por hash Git. Os sete arquivos de backend não estavam no repositório. Nenhum arquivo foi substituído por uma versão antiga do ZIP.

## Recuperado e preparado

| Origem no ZIP | Destino e finalidade |
| --- | --- |
| `netlify/functions/chat.js` | Mesmo caminho; atendimento web via OpenAI Responses |
| `netlify/functions/health.js` | Mesmo caminho; diagnóstico sem valores de credenciais |
| `netlify/functions/notify-idy-whatsapp.js` | Mesmo caminho; aviso interno por texto/template |
| `netlify/functions/creative-preview.js` | Mesmo caminho; prévia de logo/fachada |
| `netlify/functions/panel-api.mjs` | Mesmo caminho; conversas, modo humano/IA e envio manual |
| `netlify/functions/whatsapp-webhook.mjs` | Mesmo caminho; verificação e recebimento de eventos Meta |
| `netlify/functions/conversation-store.mjs` | Movido para `lib/conversation-store.mjs`; módulo de armazenamento, sem endpoint público |

Novos módulos: `lib/http.cjs`, `lib/services.cjs`, `lib/prompts.json`. As instruções originais e os preços de cartões e fachadas foram preservados em `prompts.json`. Esses valores ainda dependem do modelo para interpretação e cálculo; não constituem um motor financeiro determinístico.

Atualizados: `index.html`, `painel.html`, `package.json`, `netlify.toml` e os documentos de configuração. Acrescentados: `.gitignore`, `.env.example`, scripts de build/verificação e testes. Páginas de privacidade e exclusão mantidas sem alteração.

## Correções

- Webhook verifica HMAC SHA-256 do corpo recebido usando `META_APP_SECRET` e valida o número do atendimento.
- Eventos concluídos são registrados para impedir respostas repetidas. Falhas recuperáveis retornam erro HTTP real para permitir retentativa.
- A mensagem do cliente aparece uma única vez no contexto da IA.
- Leituras de conversas usam consistência forte e escritas condicionais por ETag. Atualizações concorrentes tentam novamente sem sobrescrever alterações alheias. Reservas temporárias por telefone coordenam webhook e painel.
- O modo humano é respeitado; resposta manual assume o atendimento antes de enviar.
- Envio de resultado incerto fica sinalizado no painel e não é repetido automaticamente. Uma API externa e o armazenamento não formam uma transação: não há garantia absoluta de entrega exatamente uma vez.
- JSON, campos, papéis de mensagens, telefones, briefing, lotes e tamanhos são validados. Chamadas externas têm limite de tempo e erros não devolvem mensagens arbitrárias dos provedores.
- Prévia exige chave interna; o retorno continua sendo imagem para aprovação, sem liberação de arquivo final.
- Chat impede requisições simultâneas por Enter. Registro do formulário e confirmação do aviso WhatsApp são apresentados separadamente.
- Painel mantém briefings por cliente, informa erros, permite logout e deixa de salvar a chave em `sessionStorage`.
- Polling passa de três para dez segundos, sem sobreposição e pausado em aba oculta. O atributo `hidden` recebe regra CSS explícita para não ser sobrescrito pelo layout.
- Build copia somente quatro páginas para `public/`; código, testes, documentação e configurações não são publicados como conteúdo estático. Cabeçalhos básicos de segurança foram adicionados.

## Testes e limites

Validação original em Node.js 24.19.0; repetida com dependências instaladas em Node.js 22.23.3 no GitHub Actions:

- `npm test`: **39 testes aprovados, zero falhas** — 33 de backend e seis de eventos das interfaces.
- `npm run check`: sintaxe das funções, módulos, testes e scripts das páginas aprovada.
- `npm run build`: build local aprovado; `public/` contém apenas atendimento, painel, privacidade e exclusão.
- Comparação criptográfica: dez arquivos existentes idênticos, sete arquivos recuperados, zero divergências.

OpenAI e Meta foram simulados; Blobs foi substituído por um adaptador em memória com operações condicionais. Os testes verificam código e contratos simulados, não o funcionamento das contas externas. Nenhuma mensagem real foi enviada e nenhuma imagem real foi gerada.

O teste visual `tests/browser-smoke.py` foi preparado, mas o Chromium falhou ao iniciar por restrições de sockets do ambiente. Não houve validação visual concluída em celular ou desktop. Os seis testes das interfaces usam DOM mínimo e não medem layout.

Atualização de 11/10/2026: o bloqueio local de npm (`EPERM` ao conectar ao proxy) foi resolvido para esta etapa usando GitHub Actions, exclusivamente na branch `recuperacao-atendimento-ia`. Foram instalados e fixados `@netlify/blobs` **11.1.4** e o empacotador oficial `@netlify/zip-it-and-ship-it` **16.3.0**. O `package-lock.json` está versionado e uma reinstalação limpa com `npm ci` passou. Os 39 testes, a sintaxe, o build estático e `npm run build:functions` passaram em **Node 22.23.3**. As seis Functions foram empacotadas para `nodejs22.x`: quatro v1 com esbuild e duas v2 com NFT, que é o comportamento obrigatório do empacotador oficial para a API v2. O SDK real foi importado, sua API básica foi conferida e seus arquivos foram incluídos nos pacotes do painel e webhook. Não houve chamada a armazenamento remoto nem validação do contexto fornecido pela plataforma. Evidência: `recovery-evidence/functions-build.json` e [execução aprovada](https://github.com/idygrafica/atendimento-idy/actions/runs/38152761117).

## Configuração necessária

Use `.env.example` como catálogo, sem colocar credenciais no GitHub.

- Chat: `OPENAI_API_KEY`; `OPENAI_MODEL` opcional.
- Prévia: chave OpenAI com acesso ao modelo de imagem e `PANEL_ACCESS_KEY`; `OPENAI_IMAGE_MODEL` opcional.
- Painel: `PANEL_ACCESS_KEY`; contexto Blobs fornecido pela plataforma em Functions v2.
- WhatsApp: `WHATSAPP_VERIFY_TOKEN`, **`META_APP_SECRET`**, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Confirmar `META_GRAPH_VERSION` compatível com o aplicativo Meta; o valor original foi preservado.
- Aviso interno: `IDY_NOTIFICATION_WHATSAPP`; template aprovado em `WHATSAPP_LEAD_TEMPLATE_NAME` e idioma, para os casos fora da janela de texto livre.
- Origem: `PUBLIC_SITE_ORIGIN` deve corresponder exatamente ao ambiente. O padrão é o endereço atual do atendimento. Em desenvolvimento, usar o domínio/porta local. Não abrir uma lista universal de origens.
- Dados: definir **explicitamente** `CONVERSATION_STORE=idy-conversations-development` em teste. O padrão `idy-conversations` foi preservado para produção. O armazenamento site-wide pode ser compartilhado entre contextos do mesmo site; nunca usar a coleção de clientes reais em testes.
- Netlify Forms: confirmar detecção do formulário, uploads, limites e notificações por e-mail na conta.

## Pendências antes de produção

1. Testar leitura, escrita condicional, concorrência e contexto de Blobs em ambiente Netlify de homologação, com dados próprios para teste. Instalação, versões fixadas, lockfile e empacotamento das Functions já foram concluídos.
2. Revisar o PR #1, já aberto na branch `recuperacao-atendimento-ia` do repositório existente. O proprietário confirmou `Current repository: Not linked` no Netlify. Merge e publicação continuam dependendo de autorização; nenhum deles foi realizado.
3. Configurar e testar OpenAI, Meta, callback assinado, template e notificações Forms. Verificar latências e limites do runtime; geração de imagens pode precisar de trabalho em segundo plano.
4. Aplicar limitação de uso/custos e proteção contra abuso aos endpoints públicos de chat e aviso interno. A checagem de Origin reduz chamadas de outros sites no navegador, mas **não autentica clientes nem bloqueia chamadas feitas por scripts**. O aviso ainda não comprova, no servidor, a existência de uma submissão Forms; recomenda-se vinculá-lo a evento validado de formulário. Essas proteções são pendências para produção.
5. Validar visualmente as telas, uploads e teclado em celular. Conferir envios incertos antes de reenviar. Mensagens manuais não possuem chave de idempotência e exigem cuidado em retentativas.
6. Definir retenção/exclusão/backup para conversas, eventos e Forms. Os eventos de deduplicação atualmente persistem; a política de limpeza precisa ser estabelecida. Leituras e lista completas não substituem um banco relacional para alto volume; testar escala/paginação.

## O que falta para autonomia completa

Unificar histórico do chat web com o painel; ler conteúdo real dos anexos e mídia WhatsApp; criar catálogo e motor determinístico de orçamentos; registrar propostas e pedidos; armazenar versões de arte e enviar/editar prévias automaticamente; implementar aprovação humana obrigatória e conferência técnica para liberar arquivos finais. Esses recursos não foram declarados concluídos nesta recuperação.

## Integração sem reconstrução

Os 35 arquivos preparados permanecem integrados à branch `recuperacao-atendimento-ia` do **mesmo** repositório, no [PR #1](https://github.com/idygrafica/atendimento-idy/pull/1). Foram acrescentados lockfile, workflow e scripts/evidência de validação. Para repetir a validação, usar Node 22, `npm ci`, `npm test`, `npm run check`, `npm run build` e `npm run build:functions`. Somente após revisão e autorização integrar à principal e publicar. O site institucional permanece preservado.

A referência para as operações de armazenamento é a [documentação oficial de Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/). A importação da API do SDK e o empacotamento com a dependência real foram aprovados; o uso autenticado da conta e a semântica de concorrência remota permanecem pendentes.

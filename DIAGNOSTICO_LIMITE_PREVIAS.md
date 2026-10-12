# Limite de prévias — diagnóstico e correção preparada

## Evidência de produção

Consulta somente de leitura em 12/10/2026, às 12:46 UTC (09:46 em Porto Alegre), no projeto `atendimento-idy`.

- Publicação conferida: `6acc37caeb3060ecc978d11b`, criada com o código `e59810a0609fb4435d55460970faf7f1d5f14dae`.
- As variáveis `IDY_ARTWORK_DAILY_LIMIT` e `IDY_ARTWORK_PER_IP_LIMIT` não estão configuradas. Portanto, valem os padrões de **20 no total e 3 por IP**. Não há configuração de apenas uma imagem.
- O armazenamento tem contadores para o dia UTC `2026-10-12`: total **5**, com dois contadores por IP de **2** e **3**. O total não atingiu o teto; o contador em 3 atingiu o limite por IP.
- O código antigo reserva primeiro a cota por IP e depois a global, antes da chamada à IA. Não devolve cota em erros de início, falhas assíncronas, respostas sem imagem ou bloqueio na reserva global.
- A data é calculada em UTC. Em Porto Alegre, a renovação acontece às **21h**, não à meia-noite. Uma tentativa feita depois das 21h de ontem já usa o mesmo contador UTC que está sendo usado hoje.
- Os contadores antigos guardam somente um número. Não permitem recuperar quais tentativas individuais falharam nem os respectivos erros do provedor. A ocorrência relatada de uma única imagem visível é compatível com três tentativas debitadas, mas os dois erros específicos não podem ser comprovados apenas por esses registros.

Diagnóstico remoto: https://github.com/idygrafica/atendimento-idy/actions/runs/38251095443

## Correção

- Janela diária por `America/Sao_Paulo`, com renovação à meia-noite e indicação do próximo horário de liberação.
- Padrões mantidos: **3 criações por IP e 20 no total por dia**. Reservas em preparação e resultados possivelmente cobrados também ocupam esses tetos de segurança.
- Reserva por IP e global em uma única atualização condicional. Se o limite global bloquear, nenhuma tentativa nem cota do IP é consumida.
- Rejeição confirmada da API e tarefa finalizada sem imagem liberam a reserva; continuam registradas no limite separado de tentativas.
- No máximo **12 tentativas por IP e 60 no total por dia**, nos valores padrão, para impedir tentativas ilimitadas mesmo quando as falhas são liberadas.
- Timeout, erro 5xx e imagem produzida mas ilegível conservam reserva de custo: o provedor pode ter gerado ou cobrado uma imagem. Esses resultados não são classificados como prévias entregues e recebem mensagem diferente de limite de imagens concluídas.
- Consultas repetidas não debitam nem devolvem a mesma cota duas vezes. Apagar uma resposta já concluída não devolve o custo de uma imagem gerada.
- Novos contadores usam `quota-v2/<dia-local>`. Os números antigos não distinguem falhas de sucesso e ficam preservados. Na ativação haverá uma nova alocação limitada; nenhum contador real foi apagado, alterado ou zerado durante esta tarefa.
- Tickets emitidos pela versão anterior continuam aceitos até a expiração original.

## Validação e estado

49 testes passaram, com relógio e serviços simulados: limites, erros confirmados, processamento, falhas incertas, chamadas simultâneas, meia-noite local, virada UTC, virada de mês/ano, repetição de consultas e compatibilidade com tickets antigos. Os testes existentes de conversa, anexos, encaminhamento e avisos de inatividade também passaram.

Não houve geração real de imagens, envio de mensagens, alteração de configurações ou publicação durante esta correção. O site institucional `idy-gr-fica` não foi alterado. A correção está na branch `codex/corrige-limite-previas` e aguarda autorização antes de qualquer publicação.

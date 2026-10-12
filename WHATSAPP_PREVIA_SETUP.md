# Prévia única e notificação de arte — configuração preparada

## Comportamento implementado

Uma prévia por identificador de atendimento, gerada a pedido do cliente sem autorização prévia do responsável. Uma falha confirmada sem imagem libera a tentativa; pedidos em andamento são retomados, em vez de criar outro trabalho. Após o sucesso, uma segunda criação ou edição é bloqueada e o cliente recebe a opção de atendimento humano. O atendimento é retomado na mesma aba após recarregar, preservando a utilização da prévia.

A renovação dos limites gerais continua à meia-noite de `America/Sao_Paulo`: padrões de 20 criações no site e 3 por IP por dia, com limites separados de 60 e 12 tentativas. A renovação diária não libera uma segunda prévia no mesmo atendimento.

O botão **Falar com atendimento humano** fica acima da área de escrita/envio, abre `https://wa.me/5551981687562` com o texto solicitado e mantém o chat da IA disponível.

## Números e credenciais

- Origem do aviso: número automatizado já cadastrado na Meta, identificado por `WHATSAPP_PHONE_NUMBER_ID` e autenticado por `WHATSAPP_ACCESS_TOKEN`.
- Destino fixo do aviso e do botão humano: **+55 51 98168-7562**. Esse número não substitui o número automatizado e não é usado como origem da API.
- Nenhum token, segredo ou credencial existente foi modificado. Eles continuam apenas no servidor.

Consulta de configuração em produção, somente de leitura:
https://github.com/idygrafica/atendimento-idy/actions/runs/38259848486

O token e o identificador do número existem, têm escopo de funções e estão protegidos como segredos. Não há `WHATSAPP_ARTWORK_TEMPLATE_NAME` nem `WHATSAPP_ARTWORK_TEMPLATE_LANGUAGE` configurados. Os valores secretos não são legíveis pela API de diagnóstico; isso impede testar a entrega real diretamente nesse ambiente de desenvolvimento sem uma configuração de teste no Netlify. A validade atual do token, o número de origem real, a janela do responsável e os templates aprovados da conta ainda não foram verificados pela Graph API.

## Template necessário

Para notificações automáticas sem depender de o responsável ter escrito ao robô nas últimas 24 horas, é necessário um template aprovado pela Meta. A implementação usa template em todos os avisos de arte; não tenta contornar a janela enviando imagem/texto livres.

Foi preparado `WHATSAPP_PREVIA_TEMPLATE.json`, ainda **não enviado à Meta**. Ele contém cabeçalho de imagem, corpo com sete parâmetros e rodapé que mantém a aprovação humana do arquivo final. A categoria sugerida é `UTILITY`; a classificação e a aprovação finais dependem da Meta.

No WhatsApp Manager, criar/aprovar esse template com uma imagem de exemplo. O marcador `SUBSTITUIR_PELO_HANDLE_DA_IMAGEM_DE_EXEMPLO_NA_META` deve ser substituído se a definição for submetida pela API. Ordem dos parâmetros:

1. Nome do cliente.
2. Telefone do cliente, ou “Não informado”.
3. Produto/serviço.
4. Quantidade.
5. Valor do orçamento informado pela IA.
6. Identificador do atendimento.
7. Data e hora em `America/Sao_Paulo`.

Dados de orçamento não definidos ou ambíguos aparecem como **A confirmar**; o sistema não inventa preço nem transforma preço unitário em valor total.

Após aprovação, configurar no Netlify:

```text
WHATSAPP_ARTWORK_TEMPLATE_NAME=idy_previa_arte_responsavel
WHATSAPP_ARTWORK_TEMPLATE_LANGUAGE=pt_BR
```

Se a Meta aprovar com outro nome/idioma, usar os valores aprovados. Manter as credenciais atuais. Não é necessário configurar WABA ID no servidor para enviar a mensagem; ele é usado apenas para gerenciamento dos templates. Se a conta ainda estiver no modo de teste da Meta, o WhatsApp do responsável precisa ser um destinatário permitido nesse ambiente.

## Envio, confirmação e falhas

A imagem gerada é enviada por multipart para `/{WHATSAPP_PHONE_NUMBER_ID}/media`. Seu ID compõe o cabeçalho de **uma única mensagem** de template enviada a `/{WHATSAPP_PHONE_NUMBER_ID}/messages`, com os sete campos no corpo. JPG e PNG são aceitos, até 5 MB.

A notificação entra em uma fila privada e é tentada imediatamente após gerar a prévia. A função agendada `artwork-notifications` (`* * * * *`) continua avisos pendentes ou falhas temporárias confirmadas. No futuro deploy autorizado, esse agendamento precisa ser incluído junto aos atuais; preservar todas as funções já publicadas e compilar os novos módulos de `lib/`.

O servidor também acompanha os trabalhos de geração: se o cliente fechar a página antes de consultar a imagem, a função agendada detecta a conclusão, marca a prévia como utilizada e enfileira a notificação. O aviso conserva os dados do orçamento no momento da geração, evitando misturar outro produto ou preço de uma conversa posterior.

Falta de configuração não bloqueia a imagem do cliente e não libera outra geração. A fila informa `configuration_required`. Rejeições temporárias têm no máximo três tentativas; mídia já enviada é reaproveitada. Timeout ou resposta ambígua no envio não provoca repetição automática, evitando duplicidade e custo adicional. Avisos pendentes são retidos por até 30 dias; a imagem privada é removida após a aceitação da mensagem pela Meta.

`accepted` significa que a Meta aceitou o envio e forneceu um identificador de mensagem. Não prova entrega ao aparelho do responsável. A entrega real deve ser conferida no WhatsApp do responsável e, se necessário, nos eventos/status da integração Meta existente. O webhook atual não foi substituído.

## Custos e limites

A Meta informa cobrança por mensagem entregue, com preço por mercado e categoria. Uma prévia usa uma mensagem de template com imagem e corpo, não duas mensagens separadas. Categoria, moeda, faixa de volume e eventual provedor podem alterar o custo; não foi possível confirmar a tarifa contratada nesta conta. O botão humano apenas abre o WhatsApp do cliente; não faz um envio automático pela Cloud API.

Fontes oficiais:
- https://business.whatsapp.com/products/platform-pricing
- https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3

## Estado antes da publicação

Verificações: 85 testes automatizados passaram localmente. O navegador Chromium verificou 320, 390, 780, 1024 e 1280 pixels: botão humano acima do envio, destino e mensagem preenchida corretos, primeira prévia com notificação simulada, segunda geração bloqueada, retomada após recarregar e conversa da IA preservada. A compilação nativa das funções também passou. Evidência da validação em navegador e compilação: https://github.com/idygrafica/atendimento-idy/actions/runs/38265339318 .

Implementação preparada em branch de teste, sem publicação. A aprovação humana do arquivo final continua obrigatória; o envio do aviso é uma notificação posterior à geração, não uma autorização para gerar.

Ainda falta aprovar/configurar o template e validar uma entrega real com as credenciais protegidas. Os testes automatizados de upload, imagem no template, campos, fila, falhas e duplicidade usam a API da Meta simulada; não comprovam entrega real. Não foram enviadas mensagens reais nem geradas imagens reais nesta implementação. O site institucional `idy-gr-fica` não foi alterado.

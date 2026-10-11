# Publicação pelo GitHub Actions — atendimento-idy

A preparação usa o repositório existente, exclusivamente na branch `recuperacao-atendimento-ia`. O ZIP não participa deste processo. Main, site institucional, credenciais Netlify e versão publicada permanecem preservados.

`prepare-netlify.yml` executa somente leitura da API Netlify. Não instala dependências da aplicação, não repete testes e não possui comando de deploy. O workflow de validação ignora alterações exclusivamente nesses arquivos de preparação e no manifesto.

## Credenciais que o runner precisa

Em **GitHub > idygrafica/atendimento-idy > Settings > Secrets and variables > Actions**:

- Repository secret `NETLIFY_AUTH_TOKEN`: token Netlify com acesso ao projeto existente. Nunca colocar o valor em arquivos, commits, logs ou conversa.
- Repository variable `NETLIFY_SITE_ID`, ou repository secret com esse nome: Project ID de `atendimento-idy`, disponível em Netlify > Project configuration > General > Project information. Usar o UUID, não o nome do projeto.

Credenciais de organização podem ser reutilizadas se estiverem liberadas para este repositório. Secrets de um GitHub Environment não são automaticamente acessíveis: este workflow não referencia nenhum Environment. Se as credenciais existirem apenas em um Environment, informar somente o nome dele para vincular a execução corretamente, preservando suas regras de aprovação.

A `META_APP_SECRET` já cadastrada no Netlify é usada pelo webhook. As variáveis da aplicação continuam no Netlify; não é necessário copiá-las para o GitHub. Elas não fornecem ao runner autenticação para publicar.

## Resultado e restauração

O workflow verifica presença das duas configurações, acesso ao projeto exato e ausência de repositório vinculado. Se houver acesso, consulta o deploy publicado anterior e registra ID e link em `netlify-preparation-<run_id>`, artefato com retenção de 30 dias. O relatório contém apenas presença de credenciais e metadados permitidos, sem valores secretos. Ainda é necessário preservar o deploy antigo no Netlify; o artefato de metadados não é uma cópia do deploy.

Sem autenticação ou deploy anterior recuperável, a preparação termina com o motivo do bloqueio e nenhuma publicação. Ausência no workflow não comprova ausência em todos os escopos GitHub.

Após confirmar o acesso, ainda devem ser conferidos contexto Production e escopo Functions das variáveis existentes, origem pública, Forms e coleção Blobs original. Não importar `.env.example` nem trocar credenciais. Usar `https://atendimento-idy.netlify.app` como origem e preservar a coleção atual, originalmente `idy-conversations`.

Antes da publicação, o responsável precisa autorizar explicitamente. Só após essa autorização será acrescentada/acionada a etapa de instalação via `npm ci` e build/deploy por CLI no runner, direcionada ao mesmo Project ID. O build faz parte do empacotamento para publicação; a suíte de testes anterior não será repetida. Não há publicação automática nesta versão da preparação.

Não é necessário criar outro projeto, conectar publicação contínua ao GitHub ou instalar programas no computador do proprietário. Um workflow somente em branch alternativa não oferece normalmente o botão `Run workflow` sem também existir na branch padrão. Para respeitar a main, a preparação atual é disparada por push dos arquivos listados; a publicação futura deverá ser acionada por uma mudança específica autorizada, com guarda explícita, ou por mecanismo de execução permitido pela conta. Não confundir um push de preparação com autorização de publicação.

Imediatamente antes da publicação autorizada, registrar novamente o deploy vigente para evitar um rollback desatualizado. Em caso de falha, abrir esse deploy em Netlify > Deploys e selecionar **Publish deploy**. O rollback de código não desfaz mensagens ou gravações no Blobs, que é persistente entre deploys. Não excluir, migrar ou limpar dados nesta implantação.

## Referências

- [Execução manual de workflows e branch padrão](https://docs.github.com/pt/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [CLI Netlify para publicação](https://cli.netlify.com/commands/deploy/)
- [API Netlify](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/)
- [Rollback Netlify](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)

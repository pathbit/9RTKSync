---
name: preparar-dev
description: Faz um projeto existente rodar na máquina ou repara seu ambiente, seguindo a stack e os comandos atuais.
---

# Preparar desenvolvimento

Inspecione somente este repositório. Reutilize o resultado atual de
[diagnosticar](../../../commands/diagnosticar/COMMAND.md) ou execute a consulta.
Confira README, arquivos ocultos, manifests, lockfiles, Makefile, Compose,
Dockerfiles, exemplos de configuração, CI e conectores. Identifique o comando
real e o que é obrigatório para o fluxo. Se a consulta ao Docker falhar, relate
**não verificado**. Sem rede permitida e sem contexto Docker comprovadamente
local, execute o script de diagnóstico com `--no-docker-probe`, conforme
o comando acima. O bootstrap faz seu próprio diagnóstico antes de encaminhar.

Só trate a seleção de clientes se o pedido envolver a instalação ou
configuração do kit. Reúna dúvidas sobre o erro, objetivo,
serviços, credenciais, versões, porta e dados a preservar.
Use o [modelo de ambiente](../../../templates/ambiente-local/TEMPLATE.md)
para as lacunas.

Execute reparos autorizados no ambiente. Preserve produto, stack e documentos.
Mudanças funcionais, de arquitetura, de versões da stack ou de dados exigem
decisão própria.
Para ferramentas do kit necessárias à tarefa, use `setup <seleção>` no
[preparo de ferramentas](../../../commands/instalar-ferramentas/COMMAND.md).
Siga os lockfiles e os comandos da stack para preparar os serviços. Se o projeto
já usar Compose, siga a [regra de ambiente](../../../rules/ambiente-local/RULE.md).
Adapte modelos quando o reparo autorizado exigir e preserve bancos, volumes e segredos.

Valide configuração, build, saúde, migrações acordadas e testes relevantes.
Use `verificar-trabalho` para o fluxo real, quando houver aplicação. Relate
comandos para subir e parar, URL ou porta, evidências e pendências. Guarde
resultados em `.agent-tests/`. Atualize documentação afetada e sincronize
se recursos agênticos mudarem. Novas funcionalidades seguem o fluxo de specs.

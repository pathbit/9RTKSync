---
name: configurar-projeto
description: Organiza a preparação do produto e, após as aprovações, comprova a configuração técnica.
---

# Configurar projeto

Inspecione somente este repositório. Para rodar ou reparar projeto existente,
use `preparar-dev`. Se o objetivo é entender e documentar o sistema em uso,
use [documentar-legado](../documentar-legado/SKILL.md).
Enquanto o usuário configurar só os agentes, mantenha modelos
em `.pbai4devs/templates/`. Ao configurar o kit, use os clientes do pedido ou
do estado. Se faltar seleção, pergunte e aplique `--agents` ou `agents`
pela CLI. Sem resposta disponível, use `all` para a seleção de clientes.
No primeiro uso, passe o objetivo com `--purpose` ou responda à pergunta
interativa para orientar a próxima ação.
Confira Node e npm e prepare somente as ferramentas necessárias à tarefa.

## Preparar o produto

Faça o inventário com `atualizar-documentacao`. Quando o produto começar,
reaproveite decisões e documentos. Crie ou retome
`.pbai4devs/state/configuracao/ESTADO.md` pelo modelo e combine onde ficam
PRD, UX/UI, design, roadmap, releases, specs, tarefas e documentos de apoio.
Evolua READMEs pelos [modelos da fase](../../../templates/README.md).
Registre provas da preparação e encaminhe a primeira etapa pendente com
`proximos-passos`. A escolha da stack acontece no design.

## Configurar a tecnologia

Exija PRD, design, spec e plano aprovados. UX/UI exige aprovação ou justificativa
de não aplicação aprovada. Preserve aprovações existentes e siga o plano.
Decisões materiais faltantes voltam ao design.

- Use [diagnosticar](../../../commands/diagnosticar/COMMAND.md).
  Se a consulta ao Docker falhar, relate **não verificado**. Sem rede permitida
  e sem contexto Docker comprovadamente local, use `--no-docker-probe`.
  Complete lacunas com as perguntas do [modelo de ambiente][ambiente].
- Prepare ferramentas compatíveis com SO e arquitetura via `preparar-ferramentas`.
  Reutilize instalações, stack e lockfiles. Aplique a [estrutura obrigatória][estrutura]
  para Makefile, Compose, dockerignore, serviços, healthchecks, portas e volumes.
  Preserve ou configure o `.editorconfig` exigido pela estrutura. Configure
  VS Code quando adotado e complete o ignore com padrões da stack. Confira
  que fontes, scripts, testes e fixtures sejam versionáveis.
- Documente versões, estrutura, comandos e origem do template ou init.
  Verifique runtime, Compose, saúde da infraestrutura e
  `inspecionar-projeto --check` com `verificar-trabalho`. Registre
  `configuracao_tecnica: concluido` só com prova das dependências e serviços
  obrigatórios. Antes disso, mantenha o código da aplicação fora da etapa.
  Se já houver aplicação, prove o fluxo real. Se ainda não houver, mantenha
  build, saúde e fluxo dela pendentes.

Após mudanças técnicas, conclua `revisar-entrega`. Sincronize e confira
`--check` somente quando recursos agênticos mudarem.

[ambiente]: ../../../templates/ambiente-local/TEMPLATE.md
[estrutura]: ../../../rules/ambiente-local/RULE.md

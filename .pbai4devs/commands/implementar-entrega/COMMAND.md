---
description: Encaminha um plano aprovado à implementação dentro do escopo.
---

# Implementar entrega

Entrada: spec e plano aprovados, responsáveis e critérios de aceite.
Confira os pré-requisitos de
[implementar-spec](../../skills/specs/implementar-spec/SKILL.md).
Se faltar aprovação ou definição, volte a
[planejar-entrega](../planejar-entrega/COMMAND.md) pela primeira etapa pendente.

Acione o [implementador](../../agents/implementador/AGENT.md) com os arquivos
sob sua responsabilidade. Ele usa a skill, testes e ferramentas do projeto;
registra dúvidas restantes antes de decidir requisitos.

Para tarefas independentes, distribua entre subagentes disponíveis e autorizados,
como [backend](../../agents/especialista-backend/AGENT.md) e
[frontend](../../agents/especialista-frontend/AGENT.md). Dê a cada um contexto,
objetivo, dependências, arquivos exclusivos para escrita e provas esperadas.
O agente principal integra as alterações, resolve interfaces e confere os resultados.
Sem suporte à delegação, execute em sequência e informe essa limitação.

Saída: diff, critérios, comandos de execução, provas preliminares e pendências.
Passe esse conjunto a [validar-entrega](../validar-entrega/COMMAND.md).
Falhas voltam ao implementador com a prova que falhou.

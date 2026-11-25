---
description: Executa scanners offline e encaminha sinais para triagem contextual.
---

# Auditar segurança

Entrada: projeto-alvo, escopo e eventual relatório existente. Por padrão,
use o projeto atual e os três checks. Reutilize um relatório se ele cobrir o
mesmo estado, escopo e checks. A coleta requer Node.js 24+, um repositório
Git e `.agent-tests/security/` ignorada e fora do índice. Confira os
[pré-requisitos do script local](../../scripts/auditar-seguranca/README.md)
antes de executar:

```console
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs run --checks secrets,dependencies,sast
```

Acrescente `--target` somente para um caminho autorizado dentro do projeto.
Leia o estado de
cada check, inclusive com retorno `0` sem achados ou `1` com achados. Retorno
`2` indica execução inválida ou cobertura incompleta. Ferramenta ou base
ausente vira pendência. Downloads usam o comando separado
[preparar-seguranca](../preparar-seguranca/COMMAND.md) quando solicitados.

Saída: relatório sem valores secretos em
`.agent-tests/security/<execucao>/report.json`. Acione o
[auditor](../../agents/auditor-seguranca/AGENT.md) com o escopo, o resultado da
coleta e o caminho do relatório, se gerado. O auditor aplica
[revisar-seguranca](../../skills/seguranca/revisar-seguranca/SKILL.md), aproveita
as provas recebidas e devolve o diagnóstico e a cobertura pendente. Se faltar
o perfil, o agente principal lê a skill e faz a triagem no escopo autorizado.

---
description: Mantém documentos e exemplos coerentes com uma alteração verificada.
---

# Atualizar documentação

Entrada: mudança, evidências e documentos relacionados.
Acione o [documentador](../../agents/documentador/AGENT.md) com a
[skill](../../skills/projeto/atualizar-documentacao/SKILL.md) correspondente.

Ele inventaria e lê o material, propõe complementos por caminho, atualiza
somente fatos confirmados e verifica links e exemplos. Scripts passam por
[executar-script](../../skills/projeto/executar-script/SKILL.md).

Saída: decisões por documento, diff e provas locais para o agente principal.
Se já houver entrega ou revisão em andamento, devolva o resultado a esse
fluxo. Para uma tarefa avulsa de documentação, use o
[gate de entrega](../revisar-entrega/COMMAND.md) para a revisão independente.

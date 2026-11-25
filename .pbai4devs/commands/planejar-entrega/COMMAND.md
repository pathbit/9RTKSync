---
description: Reúne dúvidas e produz um plano verificável para a entrega.
---

# Planejar entrega

Entrada: objetivo ou caminho da spec, restrições e decisões existentes.
Sem esse contexto, reúna as perguntas antes de propor implementação.

Acione o [planejador](../../agents/planejador/AGENT.md). Ele usa
[proximos-passos](../../skills/projeto/proximos-passos/SKILL.md) para reconhecer
a fase e encaminhar às skills de produto, design ou spec. Em projeto existente,
leia os documentos reais antes de usar templates.

Quando o escopo justificar, consulte o [arquiteto](../../agents/arquiteto/AGENT.md)
para fronteiras, alternativas, riscos e decisões de design. Identifique tarefas
independentes, dependências, responsáveis por arquivos e provas necessárias;
inclua backend, frontend, QA, segurança e performance quando aplicáveis.
Planeje subagentes conforme a capacidade do cliente, sem antecipar fases do produto.

Saída: escopo, dúvidas, tarefas, dependências, arquivos e provas por critério.
Encaminhe ao agente principal para obter as aprovações pendentes. Com a spec
e o plano aprovados, entregue-os com os aceites a
[implementar-entrega](../implementar-entrega/COMMAND.md).

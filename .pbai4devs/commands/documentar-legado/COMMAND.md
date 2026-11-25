---
description: Encaminha o levantamento de um sistema existente e sua documentação.
---

# Documentar um sistema existente

Receba o objetivo, o repositório e os fluxos ou módulos relevantes. Esclareça
somente dúvidas que mudem o escopo. Comece pelo inventário local com
`agentdevkit document --json` ou pela saída de rascunho com
`agentdevkit document --markdown`.

Acione o [documentador][perfil] com a [skill documentar-legado][skill]. Passe o
inventário e os documentos existentes. Para um pedido de leitura, devolva o
levantamento e suas limitações na resposta. Quando o pedido incluir edição,
complete os documentos autorizados e verifique os links e as evidências.

Entregue ao responsável o levantamento em rascunho, as referências por fluxo,
as lacunas e, se houver mudanças, o diff e as provas para
[revisar-entrega][revisao].

[perfil]: ../../agents/documentador/AGENT.md
[skill]: ../../skills/projeto/documentar-legado/SKILL.md
[revisao]: ../revisar-entrega/COMMAND.md

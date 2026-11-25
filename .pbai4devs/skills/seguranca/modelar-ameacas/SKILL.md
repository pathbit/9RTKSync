---
name: modelar-ameacas
description: Identifica ativos, fronteiras de confiança e ameaças do escopo aprovado.
---

# Modelar ameaças

Leia produto, design e código relacionados. Reúna primeiro as dúvidas sobre
dados, atores, operações privilegiadas e limites do ambiente. Registre o que
é fato, hipótese ou informação ausente; não invente arquitetura.

Mapeie os ativos, entradas, fluxos e fronteiras de confiança. Para cada ameaça,
descreva pré-condição, caminho de abuso, impacto, controle e teste observável.
Priorize o que o desenho realmente permite: acesso entre usuários, elevação
de privilégio, vazamento, injeção e abuso de recursos.

Use o [modelo de revisão](../../../templates/revisao-seguranca/TEMPLATE.md)
como apoio e o [auditor](../../../agents/auditor-seguranca/AGENT.md) para revisão.
Se o projeto precisar de um documento permanente, combine seu destino com o
usuário e siga [atualizar-documentacao](../../projeto/atualizar-documentacao/SKILL.md).
Rascunhos e evidências ficam em `.agent-tests/security/`.

Saída: ameaças priorizadas, controles existentes, lacunas e critérios de teste.
O modelo orienta [revisar-seguranca](../revisar-seguranca/SKILL.md); não comprova
que os controles foram implementados ou testados.

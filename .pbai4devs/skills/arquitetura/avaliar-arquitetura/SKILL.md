---
name: avaliar-arquitetura
description: Avalia e orienta decisões de arquitetura conforme requisitos e restrições do software.
---

# Avaliar arquitetura

Examine o produto, os fluxos, o design e o sistema existente. Reúna dúvidas
que mudam decisões; quando faltar definição, encaminhe ao
[design técnico](../../produto/criar-design-doc/SKILL.md). Não imponha stack.

Identifique componentes, responsabilidades, contratos, dados e fronteiras de
confiança. Avalie operação, evolução, falhas, segurança, desempenho e custos
conforme o contexto. Compare alternativas e consequências; registre decisões,
compensações e migração quando necessárias. Diagramas só quando esclarecerem.
Não atribua comportamento ao sistema inteiro pela leitura de um componente;
registre as condições e partes ainda não verificadas de cada solução.
Para durabilidade e idempotência, confira mecanismo, atomicidade e efeitos;
não trate uma chave ou um tipo de armazenamento como garantia isolada.

Questione acoplamento, perda de dados, dependências e falhas simultâneas com
cenários concretos. Delegue uma análise independente quando disponível e
permitido. Entregue decisão proposta, evidências, riscos e verificações abertas;
não apresente hipóteses como fatos. Consulte [C4](https://c4model.com/diagrams)
quando um diagrama ajudar.

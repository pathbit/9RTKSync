---
description: Finalidade e criação de skills compartilhadas.
---

# Skills

Escolha a skill pelo resultado que você precisa. A fonte fica em
`<grupo>/<nome>/SKILL.md`. O [guia compartilhado](../INSTRUCTIONS.md) mostra a
ordem de trabalho e o catálogo local `../catalog.json` reúne todos os recursos.

| Quero… | Por onde começar |
| --- | --- |
| Descobrir em que ponto o projeto está | [proximos-passos](projeto/proximos-passos/SKILL.md) |
| Preparar um produto ou configurar a tecnologia aprovada | [configurar-projeto](projeto/configurar-projeto/SKILL.md) |
| Rodar ou reparar um projeto existente na máquina | [preparar-dev](projeto/preparar-dev/SKILL.md) |
| Definir o produto, a experiência ou a arquitetura | [criar-prd](produto/criar-prd/SKILL.md), [criar-ux-ui](produto/criar-ux-ui/SKILL.md) ou [criar-design-doc](produto/criar-design-doc/SKILL.md) |
| Especificar um incremento para aprovação ou entregar um incremento aprovado | [criar-spec](specs/criar-spec/SKILL.md) ou [implementar-spec](specs/implementar-spec/SKILL.md) |
| Escolher casos de teste ou comprovar uma mudança pronta | [planejar-qa](qualidade/planejar-qa/SKILL.md) ou [verificar-trabalho](projeto/verificar-trabalho/SKILL.md) |
| Revisar o diff ou investigar uma hipótese específica de falha | [revisar-codigo](qualidade/revisar-codigo/SKILL.md) ou [validar-adversarial](qualidade/validar-adversarial/SKILL.md) |
| Diagnosticar riscos de segurança e priorizar correções | [revisar-seguranca](seguranca/revisar-seguranca/SKILL.md) |
| Conferir acesso, mapear ameaças ou corrigir um achado | [revisar-autorizacao](seguranca/revisar-autorizacao/SKILL.md), [modelar-ameacas](seguranca/modelar-ameacas/SKILL.md) ou [corrigir-vulnerabilidade](seguranca/corrigir-vulnerabilidade/SKILL.md) |

Para tarefas específicas, consulte também as skills de `git`,
[backend](desenvolvimento/implementar-backend/SKILL.md),
[frontend](desenvolvimento/implementar-frontend/SKILL.md),
[arquitetura](arquitetura/avaliar-arquitetura/SKILL.md) e
[performance](qualidade/avaliar-performance/SKILL.md).

Use `criar-skill` quando uma tarefa recorrente precisar de decisões próprias.
Para criar outro tipo de recurso, comece por `criar-recurso`. Mantenha
instruções essenciais no arquivo e detalhes opcionais em referências.
Use `usar-skills-externas` para referências curadas, `atualizar-documentacao`
para manter os documentos e `revisar-entrega` para concluir implementações.

As skills de segurança integram a instalação do kit. Os scanners exigem
[preparo explícito](../commands/preparar-seguranca/COMMAND.md).
Ao alterar o inventário, sincronize os índices e apontamentos locais.

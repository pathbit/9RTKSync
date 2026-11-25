---
name: criar-design-doc
description: Define com o usuário a arquitetura e a tecnologia do produto e registra a decisão para aprovação.
---

# Criar design técnico

Confira a preparação e suas evidências em
`.pbai4devs/state/configuracao/ESTADO.md`, o PRD aprovado e UX/UI aprovado ou
não aplicável com justificativa aprovada. Se houver lacunas, encaminhe a
primeira com `proximos-passos` antes de escrever. Use `atualizar-documentacao`
para reaproveitar o que existe.

Reúna dúvidas sobre arquitetura, tecnologia, componentes, integrações, dados,
requisitos não funcionais, segurança, testes, implantação, opções e riscos.
Use `usar-skills-externas` para referências pertinentes. Registre decisões
e pendências em `documentos.design` pelo [modelo](../../../templates/design/TEMPLATE.md),
com vínculos ao PRD e UX/UI. A instalação da stack fica para a configuração
técnica.

Documento novo ou alterado materialmente fica em `status: rascunho`.
Resolva decisões essenciais e registre `status: aprovado` com evidência só
após aprovação explícita. Preserve aprovações válidas. Avalie specs afetadas
e reabra apenas com impacto material comprovado e autorização. Registre
pendência na dúvida. Atualize README, roadmap e ADRs pertinentes.

Após a aprovação, use `proximos-passos` para encaminhar o planejamento dos
incrementos antes das specs. Siga a regra de qualidade. Sincronize somente
se recursos dos agentes mudarem.

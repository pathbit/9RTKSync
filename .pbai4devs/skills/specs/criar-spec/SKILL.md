---
name: criar-spec
description: Define com o usuário o escopo e os critérios verificáveis de um incremento para aprovação.
---

# Criar spec

Confira em `.pbai4devs/state/configuracao/ESTADO.md` as evidências da preparação.
PRD e design exigem aprovação. UX/UI exige aprovação ou justificativa de não
aplicação aprovada. Antes de criar ou alterar a spec, execute:

```sh
node .pbai4devs/scripts/verificar-configuracao/SCRIPT.mjs --preparacao
```

O comando precisa passar e as evidências e decisões precisam estar válidas
para o incremento. Se faltar verificação ou aprovação, indique a primeira etapa
pendente com `proximos-passos` e suspenda a escrita, inclusive de rascunhos.

Use `atualizar-documentacao` para reaproveitar o que existe. Reúna dúvidas sobre
nome (até 50 caracteres), objetivo, requisitos, limites e dependências, com
predecessoras e estado ou “Nenhuma”. Confira o incremento no roadmap e use
`gerenciar-roadmap` se faltar. Combine a atualização se o slug já existir.

Preencha o [modelo de spec](../../../templates/spec/TEMPLATE.md) em
`<documentos.specs>/<slug>/SPEC.md`, com o nome no H1 e slug em minúsculas, sem
acentos, com números e hífens permitidos. Vincule PRD, UX/UI, design, roadmap e
referências externas. Indique pendências, itens não aplicáveis e documentos
afetados. Para cada aceite, registre ID (como AC-001), pré-requisito, dados,
método ou comando, assertiva e caminho da prova em `.agent-tests/<spec>/<execucao>/`.
Confira links relativos e identifique comandos ainda propostos.

Uma spec nova ou alterada materialmente fica em `status: rascunho`. Resolva
dúvidas essenciais e obtenha aprovação explícita antes de registrar
`status: aprovado` e a evidência. Preserve a aprovação válida se a mudança
for imaterial. Após a aprovação, combine a release se necessário e atualize
seus links, dependências e estado, preservando outros itens. Atualize índices
afetados e encaminhe o incremento aprovado a
[planejar-entrega](../../../commands/planejar-entrega/COMMAND.md).

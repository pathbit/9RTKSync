---
name: criar-regra
description: Cria ou atualiza regras compartilhadas e seus apontamentos.
---

# Criar regra

Defina finalidade, contexto e ativação. Crie ou atualize
`.pbai4devs/rules/<nome>/RULE.md` com `description` e ativação explícita.
Preserve escopos e mapeie diferenças sem ampliar a ativação silenciosamente.
Escolha o `trigger` da fonte compartilhada conforme seu escopo:
`always_on`, `model_decision`, `glob` ou `manual`. A descrição orienta
`model_decision`, e `glob` exige `globs`.
Mantenha adaptações de outros clientes em YAMLs ao lado da fonte. O manifesto é
gerado; não o edite à mão. Confira os valores na
[compatibilidade](../../../COMPATIBILIDADE.md).

Atualize índice/guia, siga a regra de qualidade e finalize com
`sincronizar-agentes`, inclusive após renomear ou remover regras. Verifique
ativação quando possível e informe quando a leitura precisar ser explícita.

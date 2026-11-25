---
name: implementar-spec
description: Entrega um incremento com spec e plano aprovados e reúne provas por critério de aceite.
---

# Implementar spec

Use a spec, o plano aprovado e os documentos configurados em
`.pbai4devs/state/configuracao/ESTADO.md`. Confira os testes afetados, os
vínculos e as aprovações de PRD, design, UX/UI e spec. UX/UI pode ser dispensado
com justificativa aprovada. Use [reunir-contexto-spec][contexto] se puder
executar comandos. Se a coleta for incompleta, confira as fontes diretamente.
Resolva a primeira pendência apontada por [proximos-passos][proximos].

Reaproveite decisões comprovadas. Se o plano faltar ou mudar materialmente,
leve ao usuário as decisões em aberto, os riscos, o escopo e a prova de cada
aceite. Aplique o plano após a aprovação e registre-a no roadmap. Com as
aprovações em dia, conclua [configurar-projeto][configurar] e execute
[verificar-configuracao][verificar] antes do primeiro patch de código.
Prossiga com saída 0, estado válido e provas obrigatórias de infraestrutura
conferidas.

Implemente dentro do escopo, usando as convenções e testes do projeto.
Confira o diff staged e unstaged e preserve o índice e as edições existentes
pela [regra Git][git]. Resolva sobreposições de responsabilidade antes de
editar. Use o [modelo de tarefas][tarefas] em
`<documentos.tarefas>/<slug-da-spec>/TASKS.md` e vincule spec, release,
dependências, aceites e provas. Consulte skills de domínio ou
`usar-skills-externas` quando a decisão exigir, registrando as fontes usadas.
Em delegação autorizada, atribua arquivos e provas claros e confirme o diff
integrado.

Entregue diff, evidências e pendências ao agente responsável. Use
[verificar-trabalho][provas] para provar os aceites e `atualizar-documentacao`
para os fatos afetados. Atualize tarefas, roadmap e release. Sincronize se
mudou recursos agênticos. Se liderar a entrega, encaminhe para
[validar-entrega][validar] e revisão independente. Checkpoints, integração,
push e publicação seguem a autorização e os gates do projeto.

[contexto]: ../../../scripts/reunir-contexto-spec/README.md
[proximos]: ../../projeto/proximos-passos/SKILL.md
[configurar]: ../../projeto/configurar-projeto/SKILL.md
[verificar]: ../../../scripts/verificar-configuracao/README.md
[git]: ../../../rules/git/RULE.md
[tarefas]: ../../../templates/tasks/TEMPLATE.md
[provas]: ../../projeto/verificar-trabalho/SKILL.md
[validar]: ../../../commands/validar-entrega/COMMAND.md

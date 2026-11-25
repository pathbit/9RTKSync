---
name: criar-skill
description: Cria ou atualiza instruções compartilhadas para uma tarefa recorrente com decisões próprias.
---

# Criar skill

Procure primeiro uma skill existente ou referência curada que cubra a tarefa.
Crie ou atualize `.pbai4devs/skills/<grupo>/<nome>/SKILL.md`. Use `name` igual
à pasta, com minúsculas, números e hífens. Na `description`, diga quando usar
a skill de um jeito que a distinga das opções próximas.

Inclua o resultado esperado, as decisões e restrições do projeto e as provas
que mostram qualidade. Deixe o agente escolher como executar o trabalho
quando houver alternativas válidas. Reutilize regras, scripts e modelos
existentes. Vincule referências mais longas no ponto em que serão necessárias.

Siga a regra de qualidade e use `verificar-trabalho` para conferir estrutura
e comportamento relevante. Atualize guias e pontos de entrada afetados.
Gere os índices com `sincronizar-agentes` e confira `--check` separadamente.
Informe código, avisos e limites. Um apontamento comprova a integração do
arquivo. A descoberta efetiva depende do cliente. Apresente o resultado
para revisão, respeitando aprovações já dadas.

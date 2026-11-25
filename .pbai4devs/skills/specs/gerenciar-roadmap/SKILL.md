---
name: gerenciar-roadmap
description: Consulta o status e organiza specs e entregas em releases.
---

# Gerenciar roadmap

Leia o estado do projeto e seus caminhos. Numa consulta, não altere arquivos:
mostre preparação, releases, specs e tarefas com dependências e bloqueios.
Use `[ ]`, `[-]` e `[x]` conforme evidências; informe estados desconhecidos.
Se a preparação estiver apenas declarada, não a marque como concluída: informe
a falta de prova e indique `configurar-projeto` antes de PRD, UX/UI ou design.
Sem roadmap, diga que ainda não foi criado. Não conclua entregas sem prova.
Uma tarefa pendente não comprova ausência de implementação ou testes. Não
afirme ausência de artefatos ou evidências sem verificá-los; informe a lacuna.
Para iniciar produto sem preparação comprovada, indique `configurar-projeto`
antes de criar PRD ou design. Em projeto existente, confira as evidências e a
intenção: use `preparar-dev` para execução local e preserve decisões e
documentos existentes ao planejar produto.
Consulte clientes e idioma em `state/agentdevkit.json`. Em consultas de roadmap,
use os valores salvos sem pedir confirmação ou mudança; trate alterações apenas
se o usuário as solicitar.

Antes de alterar documentos, aplique o inventário de `atualizar-documentacao`.
Ao planejar ou atualizar, use o modelo só para lacunas no caminho acordado. Registre
objetivos, prioridades, etapas, dependências e pendências de PRD, UX/UI e design.
Mantenha referências e estados coerentes ao aprovar ou revisar documentos;
não invente escopo, datas ou releases. Identifique as specs do primeiro entregável
pelas dependências e pergunte por decisões faltantes.

Para uma release planejada, combine nome, prioridades e dependências. Use slug
em minúsculas sem acentos, números e hífens e o modelo de release em
`<documentos.releases>/<slug>/RELEASE.md`. Vincule specs e tarefas, preserve
outros itens e só conclua após entregas e verificações completas. A preparação
inicial não exige definir uma release.

Siga a regra de qualidade e informe arquivos e pendências. Use
`sincronizar-agentes` somente se recursos agênticos mudarem; alterações apenas
no roadmap, releases ou tarefas não exigem sincronização.

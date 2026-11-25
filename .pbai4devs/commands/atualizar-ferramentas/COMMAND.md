---
description: Atualiza as ferramentas locais dos agentes para a plataforma atual.
---

# Atualizar ferramentas

Entrada: `base`, `all`, grupo ou nome do
[índice de ferramentas](../../tools/README.md); padrão: `base`.
Pré-requisitos: Node.js 24+ com npm e acesso ao registro oficial.

Siga [preparar-ferramentas](../../skills/projeto/preparar-ferramentas/SKILL.md).
Use o [gerenciador do hub](../../scripts/preparar-ferramentas/README.md) com
`update <seleção>`; depois, confira a mesma seleção com `check`. Para uma
ferramenta, também pode chamar
`node <pasta-da-ferramenta>/SCRIPT.mjs` com `update` e `check`.

Saída: versões, plataforma, alterações e falhas. Instalações ficam somente em
`.pbai4devs/tools/<nome>/.local/`; preserve a versão anterior em caso de falha.

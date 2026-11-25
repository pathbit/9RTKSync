---
description: Prepara o runtime quando necessário e instala as ferramentas locais selecionadas.
---

# Instalar ferramentas

Entrada: `base`, `all`, grupo ou nome do [índice](../../tools/README.md).
Escolha a seleção pelo pedido e pelos requisitos do fluxo. O gerenciador usa
`all` quando a seleção é omitida. Para os plugins de fluxo, escolha
`workflow` ou o ID de uma ferramenta.

Sem Node, instale Node e npm pelo mecanismo do sistema operacional. Com
Node 18+ disponível e runtime incompatível, siga o
[bootstrap JavaScript](../../scripts/preparar-ferramentas/BOOTSTRAP.md) com a
seleção de ferramentas. Para preparar só o runtime, use `--runtime-only`.

Siga [preparar-ferramentas](../../skills/projeto/preparar-ferramentas/SKILL.md).
Com Node e npm prontos, use `setup <seleção>` no
[gerenciador do hub](../../scripts/preparar-ferramentas/README.md).
O fluxo instala o que faltar e verifica cada CLI, preservando
instalações saudáveis. Rede é necessária quando faltar instalação.

Saída: versões, plataforma, resultados e itens não aplicáveis ou com falha.
Pacotes ficam ignorados em `.local/`; dependências de UI seguem a tarefa.
Para buscar versões mais recentes, use [atualizar](../atualizar-ferramentas/COMMAND.md).

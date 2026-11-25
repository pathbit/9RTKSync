---
name: preparar-ferramentas
description: Instala, atualiza ou verifica ferramentas locais do hub pelo nome ou grupo solicitado.
---

# Preparar ferramentas

Identifique a operação e a seleção no [catálogo de ferramentas][catalogo].
Reutilize Node.js 24+ e confira o npm. Sem runtime compatível, siga o
[bootstrap][bootstrap]. O bootstrap de `instalar-ferramentas` chama
`setup` uma vez. Para consultar ou executar uma ferramenta, prepare só o
runtime quando necessário e retome a operação original.

No [gerenciador][script], use `setup <seleção>` para preparar e verificar,
`install <nome>` ou `update <nome>` para mudar uma instalação, e
`info`, `check` ou `run <nome> [argumentos]` para usar o que existe. Veja
o [comando de instalação][instalar] para escolher a seleção inicial.

Confira as plataformas no `TOOL.json`. A atualização npm usa o registro
oficial. Scanners nativos seguem os pins revisados do catálogo. Para
segurança, use
[preparar-seguranca][seguranca] para distinguir o CLI, a base e a execução
offline. Em navegador, desktop, proxy ou gravação, consulte o guia da
ferramenta e confira dependências e permissões conforme o fluxo real.

Informe versões, resultados e itens não aplicáveis. Instalações anteriores
saudáveis são reutilizadas ou preservadas em falhas. Um probe comprova a
sondagem do executável. Use [verificar-trabalho][verificar] para provar
funcionamento no caso de uso.

[catalogo]: ../../../tools/README.md
[bootstrap]: ../../../scripts/preparar-ferramentas/BOOTSTRAP.md
[script]: ../../../scripts/preparar-ferramentas/README.md
[instalar]: ../../../commands/instalar-ferramentas/COMMAND.md
[seguranca]: ../../../commands/preparar-seguranca/COMMAND.md
[verificar]: ../verificar-trabalho/SKILL.md

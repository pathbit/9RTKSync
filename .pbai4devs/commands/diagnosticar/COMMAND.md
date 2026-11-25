---
description: Identifica o ambiente local e a estrutura do projeto sem alterações.
---

# Diagnosticar

Entrada: projeto atual. Com Node.js 24+ disponível, execute diretamente
[diagnosticar-ambiente](../../scripts/diagnosticar-ambiente/) e
[inspecionar-projeto](../../scripts/inspecionar-projeto/), sem `--check`:

```sh
node .pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs
node .pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs
```

Se rede não for permitida e o contexto Docker não estiver comprovado como
local, passe `--no-docker-probe` ao diagnóstico. Se falta runtime, informe
o pré-requisito. A consulta só inspeciona e não inicia a aplicação.
Interprete a disponibilidade informada; saída zero não aprova dependências
ausentes ou ferramentas ainda não verificadas.

Saída: tipo de projeto, SO, ferramentas disponíveis e pendências. Resuma os
resultados; salve relatórios em `.agent-tests/` quando necessários. Use
[preparar-dev](../preparar-dev/COMMAND.md) se o pedido incluir reparo ou preparo.

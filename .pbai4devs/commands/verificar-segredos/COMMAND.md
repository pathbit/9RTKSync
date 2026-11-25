---
description: Procura sinais de credenciais expostas com scanner local.
---

# Verificar segredos

Entrada: projeto autorizado. Confira os
[pré-requisitos de coleta](../auditar-seguranca/COMMAND.md) e execute o
script offline usando as ferramentas já preparadas:

```console
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs run --checks secrets
```

Leia os retornos e a cobertura no [guia do script](../../scripts/auditar-seguranca/README.md).
Para triagem, use [revisar-seguranca](../../skills/seguranca/revisar-seguranca/SKILL.md)
com o relatório e o escopo de segredos.
Um sinal não prova que a credencial é ativa; não tente autenticá-la.
Não copie o valor encontrado para a conversa. Encaminhe segredo real ao
responsável e use
[corrigir-vulnerabilidade](../../skills/seguranca/corrigir-vulnerabilidade/SKILL.md).
Remover o texto não revoga o segredo nem apaga cópias no histórico.

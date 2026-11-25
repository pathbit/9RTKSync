---
description: Verifica dependências usando bases locais de vulnerabilidades.
---

# Verificar dependências

Entrada: projeto e seus manifests/lockfiles. Se faltar base dos ecossistemas
presentes, registre a lacuna. Downloads solicitados seguem
[preparar-seguranca](../preparar-seguranca/COMMAND.md).
Confira os [pré-requisitos de coleta](../auditar-seguranca/COMMAND.md)
e execute o script offline:

```console
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs run --checks dependencies
```

Leia os retornos e a cobertura no [guia do script](../../scripts/auditar-seguranca/README.md).
Para triagem, use [revisar-seguranca](../../skills/seguranca/revisar-seguranca/SKILL.md)
com o relatório e o escopo de dependências.
Sem base adequada ou pacote reconhecido, não declare dependências aprovadas.
Triagem considera versão, alcance e mitigação. Não execute `audit fix --force`
nem atualize tudo automaticamente; proponha a menor correção verificável.

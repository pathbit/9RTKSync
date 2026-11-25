---
description: Proxy local opcional para URLs estáveis de desenvolvimento.
---

# Portless

Origem: [documentação oficial](https://portless.sh). Apache-2.0; Node 24+.
Configuração e canal `latest`: [TOOL.json](TOOL.json).

```console
node .pbai4devs/tools/portless/SCRIPT.mjs install
node .pbai4devs/tools/portless/SCRIPT.mjs run --help
```

Use o proxy quando a tarefa exigir, seguindo o preparo previsto no projeto.
Comandos de execução podem iniciar serviços e configurar CA, confiança
ou hosts; `install` do adaptador apenas prepara o CLI. O estado usa
`.local/state/` por `PORTLESS_STATE_DIR`; alterações do SO seguem o fluxo
explícito de configuração da ferramenta. Use o script com o binário local.

[Operações comuns e plataformas](../README.md).

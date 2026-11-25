---
description: Execução local de Bash em ambiente virtual.
---

# Just Bash

Origem: [Vercel Labs][source]. Apache-2.0; Node 24+.
Configuração e canal `latest`: [TOOL.json](TOOL.json).

```console
node .pbai4devs/tools/just-bash/SCRIPT.mjs install
node .pbai4devs/tools/just-bash/SCRIPT.mjs run -c 'printf "ok\n"' --json
```

`--root <pasta>` lê arquivos do disco e bloqueia escritas por padrão.
`--allow-write` habilita escritas em um OverlayFS em memória, descartadas ao
final; os arquivos do host são preservados.
Use este CLI para tarefas de shell compatíveis; verifique aplicações com seus
testes e runtimes reais. Pacotes ficam em `.local/`.

[Operações comuns e plataformas](../README.md).

[source]: https://github.com/vercel-labs/just-bash/tree/main/packages/just-bash

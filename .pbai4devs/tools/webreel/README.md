---
description: Validação de roteiros e gravações locais de navegador.
---

# Webreel

Origem: [documentação oficial](https://webreel.dev). Apache-2.0; Node 24+.
Configuração e canal `latest`: [TOOL.json](TOOL.json).

```console
node .pbai4devs/tools/webreel/SCRIPT.mjs install
node .pbai4devs/tools/webreel/SCRIPT.mjs run validate -c roteiro.json
node .pbai4devs/tools/webreel/SCRIPT.mjs run record --dry-run -c roteiro.json
```

Para gravar, informe os executáveis existentes em `CHROME_HEADLESS_PATH`,
`CHROME_PATH` e `FFMPEG_PATH`; sem os overrides o CLI baixa em `~/.webreel`.
`validate`, `record --dry-run` e os probes dispensam esses downloads.
Salve vídeos, frames e capturas em `.agent-tests/`; versione os roteiros.

Adaptador: macOS x64/ARM64, Linux x64 e Windows x64. Outras arquiteturas
exigem executáveis compatíveis por override e validação antes de ampliar o
[TOOL.json](TOOL.json). [Operações comuns](../README.md).

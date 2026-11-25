---
description: Fontes de dependências com cache local isolado.
---

# Opensrc

Origem: [Vercel Labs][source]. Apache-2.0; Node 24+ e Git para obter fontes.
Configuração e canal `latest`: [TOOL.json](TOOL.json).

```console
node .pbai4devs/tools/opensrc/SCRIPT.mjs install
node .pbai4devs/tools/opensrc/SCRIPT.mjs run list --json
node .pbai4devs/tools/opensrc/SCRIPT.mjs run path --help
```

O instalador usa `--ignore-scripts`: o pacote inclui os binários nativos e seu
`postinstall` pode alterar atalhos globais. `OPENSRC_HOME` direciona fontes e
índice em `.local/cache/`. `path pacote@versao` baixa fontes ausentes no cache;
`list --json` consulta o índice. Downloads de fontes seguem a necessidade da
tarefa; dependências da aplicação são decididas após os documentos de produto.

Suporta macOS/Linux x64 e ARM64, Linux musl e Windows x64. O release atual
não inclui binário Windows ARM64. [Operações comuns](../README.md).

[source]: https://github.com/vercel-labs/opensrc/tree/main/packages/opensrc

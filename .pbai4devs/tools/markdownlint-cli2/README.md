---
description: Origem e uso local do Markdown lint.
---

# Markdownlint-cli2

Origem: [repositório oficial](https://github.com/DavidAnson/markdownlint-cli2).
O [TOOL.json](TOOL.json) define o pacote npm, canal `latest` e um probe de lint.

```console
node .pbai4devs/tools/markdownlint-cli2/SCRIPT.mjs install
node .pbai4devs/tools/markdownlint-cli2/SCRIPT.mjs update
node .pbai4devs/tools/markdownlint-cli2/SCRIPT.mjs run README.md
```

Exige Node 24+/npm para o preparo; usa JavaScript, sem binário nativo próprio.
`check` executa lint numa entrada válida. A aplicação dos padrões do projeto
fica em `verificar-recursos`; relatórios locais ficam em `.agent-tests/`.

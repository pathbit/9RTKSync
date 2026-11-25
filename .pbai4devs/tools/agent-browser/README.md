---
description: Origem e uso local do agent-browser.
---

# Agent-browser

Origem: [instalação oficial](https://agent-browser.dev/installation).
O [TOOL.json](TOOL.json) define o pacote npm, canal `latest`, plataformas e probe.
O campo `executables` declara os binários que recebem permissão de execução
no preparo POSIX, sem habilitar scripts de instalação do pacote.

```console
node .pbai4devs/tools/agent-browser/SCRIPT.mjs install
node .pbai4devs/tools/agent-browser/SCRIPT.mjs update
node .pbai4devs/tools/agent-browser/SCRIPT.mjs run --version
```

Use `check` para conferir a instalação e `info` para ver sua configuração.
O preparo exige Node 24+/npm. Use Chrome/Chromium existente por
`run --executable-path <caminho> ...`; o script não baixa um navegador.
O launcher publicado para Windows ARM64 pode usar o binário x64 em emulação.
Antes da automação, leia `run skills get core` da versão instalada.
Pacotes e registros de instalação ficam em `.local/`; o estado próprio do CLI
pode usar `~/.agent-browser`, conforme a
[configuração oficial](https://agent-browser.dev/configuration). O script não
altera `HOME`. Os testes usam sessão própria e a encerram ao terminar.

Se o navegador recusar o nome da sessão por causa do comprimento do socket
Unix, defina `AGENT_BROWSER_SOCKET_DIR` para um diretório privado com caminho
curto. Isso pode ser necessário ao executar testes em uma pasta temporária
profunda no macOS.

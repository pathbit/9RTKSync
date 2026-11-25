---
description: Origem e uso local opcional do agent-desktop.
---

# Agent-desktop

Origem: [instalação oficial](https://agent-browser.dev/desktop/installation).
O [TOOL.json](TOOL.json) define o pacote npm, canal `latest`, plataformas e probe.

```console
node .pbai4devs/tools/agent-desktop/SCRIPT.mjs install
node .pbai4devs/tools/agent-desktop/SCRIPT.mjs update
node .pbai4devs/tools/agent-desktop/SCRIPT.mjs run status
```

Use `check` para conferir a instalação e `run version` para ver a versão.
O script usa `AGENT_DESKTOP_HOME` em `.local/state`, sem alterar `HOME`.
O preparo comum exige Node 24+/npm. A interação depende do SO:
[macOS 13+ e permissões](https://agent-browser.dev/desktop/platforms/macos),
[Linux com glibc e sessão AT-SPI](https://agent-browser.dev/desktop/platforms/linux)
ou Windows compatível. Instalar não concede permissões nem abre aplicações.
Antes de agir, leia `run skills get desktop` e `run skills get platform`.

O teste [SMOKE_DESKTOP.mjs](../../scripts/preparar-ferramentas/tests/SMOKE_DESKTOP.mjs)
abre um Chrome isolado e lê sua janela por acessibilidade, sem entrada física.
Exige sessão gráfica, permissões e Chrome instalado; encerra sua própria sessão.

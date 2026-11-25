---
description: Descoberta de skills externas com o CLI oficial.
---

# Skills

Origem: [Vercel Labs](https://github.com/vercel-labs/skills). MIT; Node 24+.
Configuração e canal `latest`: [TOOL.json](TOOL.json).

```console
node .pbai4devs/tools/skills/SCRIPT.mjs install
node .pbai4devs/tools/skills/SCRIPT.mjs run find testing
node .pbai4devs/tools/skills/SCRIPT.mjs run add vercel-labs/agent-skills --list
```

Use `find` e `add <origem> --list` para descoberta. Importações seguem
`criar-skill` e `sincronizar-agentes`, preservando a origem em `.pbai4devs`.
`use <origem>@<skill>` sem `--agent` imprime o prompt sem instalar nem lançar
outro agente.
`add` sem `--list`, `update` e `sync` alteram skills, links, cópias ou locks;
exigem um pedido específico. Telemetria desativada com `DISABLE_TELEMETRY=1`;
estado em `.local/state/` por `XDG_STATE_HOME`.

[Operações comuns e plataformas](../README.md).

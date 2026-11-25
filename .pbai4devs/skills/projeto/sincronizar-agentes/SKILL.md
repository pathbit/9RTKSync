---
name: sincronizar-agentes
description: Atualiza ou verifica catálogos e apontamentos após alterações nos recursos compartilhados.
---

# Sincronizar agentes

Depois de criar, alterar, mover ou retirar uma fonte agêntica, use a CLI da
versão instalada com Node.js 24+. O [comando sincronizar][comando] explica
quando usar o plano da CLI e o [manual do script][script] cobre o uso direto.

```sh
agentdevkit sync --dry-run --json
agentdevkit sync --json
agentdevkit sync --check --json
```

Confira o plano, os conflitos e `preserved` antes de aplicar. Preserve arquivos
próprios, links opacos, regras de ignore e o índice Git. `--force` respeita as
mesmas fronteiras. Revise o backup antes de restaurar qualquer arquivo.

As fontes ficam em `.pbai4devs`. O sync gera os catálogos e apontamentos para
os clientes salvos. Para mudar a seleção, use `agents`. Trate os JSON derivados
e o manifesto gerado como saídas. Templates, scripts, ferramentas, estado,
testes e documentos ficam no hub ou no projeto, fora dos espelhos.

[comando]: ../../../commands/sincronizar/COMMAND.md
[script]: ../../../scripts/sincronizar-agentes/README.md

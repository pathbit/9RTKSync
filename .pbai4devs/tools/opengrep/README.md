---
description: Instalacao local revisada do opengrep.
---

# opengrep

Executa regras SAST armazenadas no projeto.

Versao revisada: **1.33.1**. Licenca: [LGPL-2.1](https://github.com/opengrep/opengrep/blob/v1.33.1/LICENSE).
Downloads vem da [release oficial](https://github.com/opengrep/opengrep/releases/tag/v1.33.1);
cada plataforma tem SHA-256 fixado em `TOOL.json`.

`SCRIPT.mjs install` baixa e verifica o executavel. `update` aplica a versao
revisada do catalogo; nao seleciona `latest` sem revisao. `check` verifica
integridade e versao sem rede; `run` preserva argumentos e codigo de saida.
Use `node .pbai4devs/tools/opengrep/SCRIPT.mjs <acao>`.

Use `--config` com regras locais e `--disable-version-check`. Nao use `auto`
ou URLs de regras no modo local.

Binarios, caches e resultados ficam locais e ignorados. O CLI nao exige
conta nem pagamento. Consulte o [gerenciador](../../scripts/preparar-ferramentas/README.md).

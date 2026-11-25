---
description: Instalacao local revisada do osv-scanner.
---

# osv-scanner

Compara dependencias com bases de vulnerabilidades baixadas previamente.

Versao revisada: **2.7.1**. Licenca: [Apache-2.0](https://github.com/google/osv-scanner/blob/v2.7.1/LICENSE).
Downloads vem da [release oficial](https://github.com/google/osv-scanner/releases/tag/v2.7.1);
cada plataforma tem SHA-256 fixado em `TOOL.json`.

`SCRIPT.mjs install` baixa e verifica o executavel. `update` aplica a versao
revisada do catalogo; nao seleciona `latest` sem revisao. `check` verifica
integridade e versao sem rede; `run` preserva argumentos e codigo de saida.
Use `node .pbai4devs/tools/osv-scanner/SCRIPT.mjs <acao>`.

Use `--offline` para impedir consultas durante a varredura. A atualizacao das
bases e uma operacao separada; ausencia de base nao significa ausencia de
vulnerabilidades.

Binarios, caches e resultados ficam locais e ignorados. O CLI nao exige
conta nem pagamento. Consulte o [gerenciador](../../scripts/preparar-ferramentas/README.md).

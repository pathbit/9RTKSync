---
description: Instalacao local revisada do gitleaks.
---

# gitleaks

Procura segredos em arquivos e no historico Git.

Versao revisada: **8.30.1**. Licenca: [MIT](https://github.com/gitleaks/gitleaks/blob/v8.30.1/LICENSE).
Downloads vem da [release oficial](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1);
cada plataforma tem SHA-256 fixado em `TOOL.json`.

`SCRIPT.mjs install` baixa e verifica o executavel. `update` aplica a versao
revisada do catalogo; nao seleciona `latest` sem revisao. `check` verifica
integridade e versao sem rede; `run` preserva argumentos e codigo de saida.
Use `node .pbai4devs/tools/gitleaks/SCRIPT.mjs <acao>`.

Use os comandos de seguranca do kit para obter saida redigida. Resultados
exigem triagem; revogar credenciais reais continua necessario.

Binarios, caches e resultados ficam locais e ignorados. O CLI nao exige
conta nem pagamento. Consulte o [gerenciador](../../scripts/preparar-ferramentas/README.md).

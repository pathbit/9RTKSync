---
description: Prepara scanners locais e bases públicas para a análise offline.
---

# Preparar segurança

Entrada: projeto e ecossistemas de dependências, como `npm` ou `Go`.
Confira Node.js 24+ e os
[pré-requisitos](../../scripts/preparar-ferramentas/README.md).

Use [executar-script](../../skills/projeto/executar-script/SKILL.md):

```console
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs setup security
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs update-data --ecosystems npm,Go
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs check
```

Escolha somente os ecossistemas presentes; não baixe bases por suposição.
A atualização usa downloads públicos, sem enviar fontes ou inventários.
Saída: ferramentas e bases preparadas, versões e pendências. Não inicia
servidores nem faz testes de segurança da aplicação.

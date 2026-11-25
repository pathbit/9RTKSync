---
description: Instala e verifica skills externas do catálogo revisado.
---

# Gerenciar skills externas

Use Node.js 24+ e prepare o CLI com
`node .pbai4devs/tools/skills/SCRIPT.mjs install`. Os comandos aceitam um ID do
[catálogo](../../external-skills/CATALOG.json):

```console
node .pbai4devs/scripts/gerenciar-skills-externas/SCRIPT.mjs list
node .pbai4devs/scripts/gerenciar-skills-externas/SCRIPT.mjs discover cloudflare-web-perf
node .pbai4devs/scripts/gerenciar-skills-externas/SCRIPT.mjs install cloudflare-web-perf
node .pbai4devs/scripts/gerenciar-skills-externas/SCRIPT.mjs check cloudflare-web-perf
node .pbai4devs/scripts/gerenciar-skills-externas/SCRIPT.mjs read cloudflare-web-perf
```

`list`, `check` e `read` não acessam a rede. `discover` lista a origem fixada
usando o CLI oficial. `install` reutiliza a cópia verificada; `update <id>`
aplica o pin revisado do catálogo ou restaura conteúdo local alterado. Revise
origem, licença e instruções antes de mudar uma entrada para `reviewed`.

Na CLI do kit instalado, prepare o pré-requisito com
`agentdevkit plugins install skills`. Use `plugins info <id>` para consultar
a origem e a revisão, e `plugins install <id>` ou `plugins check <id>`
para operar sobre a entrada revisada. Entradas candidatas servem à avaliação.

Downloads usam `skills add` com `--agent universal --copy --yes`, em pasta
isolada. O gerenciador confere origem, SHA, caminho e conteúdo; preserva a
instalação anterior quando o preparo falha. Ele não chama `skills update`,
não executa scripts da skill e não altera o catálogo nem os espelhos.
A subpasta `.agents/skills` dentro do download é o formato do CLI universal;
ela permanece no cache de `.pbai4devs`, sem ocupar o espelho `.agents` do projeto.

Teste offline: `node --test .pbai4devs/scripts/gerenciar-skills-externas/tests/TEST.mjs`.

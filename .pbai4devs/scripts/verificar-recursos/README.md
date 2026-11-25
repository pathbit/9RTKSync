---
description: Verificação dos recursos compartilhados e de seus apontamentos.
---

# Verificar recursos

```sh
node .pbai4devs/scripts/verificar-recursos/SCRIPT.mjs
node .pbai4devs/scripts/verificar-recursos/SCRIPT.mjs --source-only
node --test .pbai4devs/scripts/verificar-recursos/tests/TEST.mjs
```

Exige Node 24+. Confere espelhos, frontmatter/H1, links locais e guias das
ferramentas. Ignora pacotes baixados e resultados temporários, inclusive
Playwright em qualquer caixa. Fixtures comuns continuam verificadas.
Inclui Markdown da raiz, de `docs/`, `src/`, `bin/`, `tests/`, `scripts/`,
`examples/` e templates de contribuição do GitHub. Exclui `examples/generated/`.
Essa coleta usa somente o diretório informado, sem buscar outro repositório Git.
Usa o Markdown lint local
quando instalado e informa sua ausência. Não instala nem sincroniza recursos.
Testes e fixtures são versionados; temporários ficam em `.agent-tests/`.

`--source-only` valida as fontes sem exigir catálogos, manifesto ou clientes
gerados. Referências aos índices derivados são conferidas pelo catálogo em
memória; links para fontes inexistentes continuam sendo erros.

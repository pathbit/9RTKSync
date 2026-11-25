---
description: Verificação dos documentos, da revisão e das evidências da entrega.
---

# Revisar entrega

Após implementar, atualizar a documentação afetada e testar, gere o registro:

```sh
node .pbai4devs/scripts/revisar-entrega/SCRIPT.mjs prepare --id minha-mudanca
```

Use `--spec caminho/SPEC.md` para extrair os critérios `AC-001` da spec.
`--scope arquivo` limita uma revisão; sem ele, o snapshot reúne alterações Git.
Use `--document arquivo` para incluir PRD, design e outros documentos.
Na coleta automática, submódulos, índice esparso, flags que ocultam mudanças e
filtros Git aplicados são bloqueados; use `--scope` quando o escopo for
conhecido. Índice dividido e clone parcial são recusados em qualquer modo.
README, AGENTS, CLAUDE e GEMINI versionáveis na raiz entram automaticamente na
revisão, mesmo sem alterações. Saídas locais ignoradas fora do índice não são
documentos obrigatórios; documentos rastreados continuam cobertos mesmo quando
uma regra de ignore corresponde ao nome.
Preencha decisões, resultados e evidências no JSON retornado; peça revisão
independente, execute `seal <caminho/revisao.json>` e depois
`check <caminho/revisao.json>` antes de concluir.

`check` valida somente o escopo dos relatórios. Antes de um commit, use
`check-commit <relatorio> [outros-relatorios...]`: todos os arquivos preparados
devem estar cobertos por revisões seladas. O comando aceita somente arquivos
regulares com modo Git `100644` e compara os bytes preparados aos revisados;
normalizações por filtros ou CRLF que mudem os bytes são bloqueadas. Cada blob
preparado está limitado a 64 MiB.

Antes de um merge fast-forward, use `check-merge --destino refs/heads/<branch>
<relatorio> [outros-relatorios...]` na origem. Ele compara o commit e todo o diff
com as revisões seladas; confirme os hashes retornados antes de integrar.

O check recusa resultados pendentes, evidências ausentes/versionadas e arquivos
alterados depois da revisão. Relatórios ficam em
`.agent-tests/<id>/<execução>/`.
O preparo preserva o escopo em `baseline.json`; o selo registra hashes do
relatório e das provas em `seal.json`. Preserve esses metadados no fluxo.
Mudanças posteriores exigem nova execução, preservando as evidências anteriores.
Uma deleção staged com arquivo ainda presente e ignorado é registrada como
`indexAction: untrack`. O snapshot preserva seu hash físico; alterações no
arquivo, no ignore ou nessa ação do índice invalidam a revisão. Diferenças
entre índice e conteúdo testado continuam bloqueadas, inclusive com `--scope`.
O script confere o registro; a revisão semântica continua sendo responsabilidade
do revisor. As saídas bem-sucedidas incluem `reviewVerification: "not-verified"`:
o script não autentica o revisor nem confirma que a revisão ocorreu. Veja a skill
[atualizar-documentacao](../../skills/projeto/atualizar-documentacao/SKILL.md).

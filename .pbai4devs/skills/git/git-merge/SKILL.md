---
name: git-merge
description: Integra branches com trabalho concluído e verificado.
---

# git-merge

Confira origem, destino, histórico, identidades, mensagens, alterações locais e
verificações; integre somente tarefas completas conforme AGENTS.md. Se os
commits a integrar identificarem agentes como autores ou coautores, informe e
não os integre.

Quando houver implementação ou gate exigido, na origem execute isoladamente:

```sh
node .pbai4devs/scripts/revisar-entrega/SCRIPT.mjs check-merge \
  --destino refs/heads/<branch> <revisao.json> [outros...]
```

O check exige fast-forward, cobertura de todo o diff e snapshots correspondentes
ao commit de origem; qualquer falha bloqueia a integração. Registre os hashes
de origem e destino retornados e confirme ambos imediatamente antes do merge,
com comandos que interrompam a execução em qualquer falha; não mascare o status.
Confirme também que `git symbolic-ref HEAD` é a ref de destino e que o HEAD
corresponde ao hash de destino validado. Se alguma conferência falhar,
interrompa; se os hashes mudarem, refaça a revisão e o check. Integre com
`git merge --ff-only <hash-da-origem-validada>`. Essas verificações não são
atômicas. O check recusa links, submódulos, arquivos executáveis e saídas Git
maiores que 64 MiB; informe bloqueios sem contorná-los. Preserve trabalho fora
do escopo.
Se o resultado integrado divergir do conteúdo revisado, faça nova revisão e
verificações antes de concluir. Sem implementação, siga os critérios aplicáveis.

Se gerar commit de merge, confira as identidades efetivas e siga
`.pbai4devs/rules/git/RULE.md` para identidade, mensagem e assinatura. Preserve
alterações, resolva conflitos no escopo autorizado e respeite proteções da branch.

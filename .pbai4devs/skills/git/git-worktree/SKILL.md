---
name: git-worktree
description: Cria ou inspeciona worktrees para trabalho paralelo.
---

# git-worktree

Confira worktrees e branches existentes. Para agentes paralelos, crie worktrees
com branches auxiliares distintas; preserve alterações e só integre trabalho
concluído e verificado.

Inspecione sem editar conteúdo e siga a [regra Git](../../../rules/git/RULE.md):
mesmo consultas podem alterar o índice. Criar outra worktree em diretório
adequado e branch disponível não exige commitar, stashear ou gerar patches das
alterações existentes. Diffs comuns não incluem arquivos não rastreados.
Preserve índice e conteúdo e não recomende essas ações sem avaliar a intenção.
No `git status --short`, `AM` indica arquivo adicionado ao índice e modificado
depois na árvore de trabalho.

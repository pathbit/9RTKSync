---
name: git-diff
description: Examina e resume alterações Git.
---

# git-diff

Examine os diffs preparados e não preparados conforme o pedido, incluindo
arquivos não rastreados quando relevantes. Use `GIT_OPTIONAL_LOCKS=0` nas
consultas, mas não presuma que preserve os bytes do índice: `git diff` ainda
pode atualizá-lo. Se a preservação exata for exigida, não execute uma consulta
sem método comprovadamente seguro para o repositório; informe a limitação.
Uma cópia do índice, por si só, não comprova preservação de `sharedindex` em
repositórios com split-index.

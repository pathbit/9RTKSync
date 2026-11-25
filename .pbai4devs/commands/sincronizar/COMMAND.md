---
description: Atualiza ou confere os apontamentos compartilhados dos agentes.
---

# Sincronizar

Entrada: `sync` da CLI usa as fontes locais e não implica `--force`;
`update` usa as fontes da versão do pacote executado. Pré-requisito: Node.js 24+.

Siga [sincronizar-agentes](../../skills/projeto/sincronizar-agentes/SKILL.md):
revise o plano da CLI, aplique e confira. A reconstrução repara
apontamentos e remove saídas obsoletas cuja propriedade do kit foi comprovada.
Recursos adicionais, configurações, pastas e links humanos são preservados,
inclusive em colisões de nomes. O backup local não substitui o histórico Git.
Após reparar, execute também `--check`. Se a CLI não estiver no PATH, use a
versão indicada em `.pbai4devs/state/agentdevkit.json`. Acrescente
`sync --dry-run`, `sync` ou `sync --check` ao comando abaixo.

```sh
npx --yes --ignore-scripts --package=@pathbit/agentdevkit@VERSAO agentdevkit
```

O script direto usa o manifesto existente e não inclui automaticamente novos
YAMLs nativos. Respeite os clientes selecionados. Para mudar a seleção salva,
use `agentdevkit agents <lista>`; sincronizar não ativa todos os clientes.

Saída: apontamentos atualizados ou divergências encontradas. Templates,
scripts, ferramentas, estado, testes, documentos e guias ficam fora dos espelhos.

---
description: Índice da estrutura compartilhada dos agentes.
---

# Recursos do AgentDevKit

`.pbai4devs` é a origem compartilhada dos recursos instalados pelo AgentDevKit.
Para a ordem de trabalho e os comandos,
leia [INSTRUCTIONS.md](INSTRUCTIONS.md).
O catálogo local `catalog.json` é gerado das fontes pelo sincronizador.
Ele inclui recursos, ferramentas, automações, modelos e referências externas.
Os arquivos `skills.json`, `rules.json` e `agents.json` são índices auxiliares
das fontes. Os clientes selecionados usam seus diretórios de apontamentos.
O estado `state/agentdevkit.json` guarda a seleção em `clients`, com os IDs
escolhidos ou um dos modos `all` e `none`. O manifesto local `espelhos.conf`
registra como o sincronizador projeta essa seleção. Catálogos, manifesto e
estado são derivados locais. As pastas nativas também podem conter arquivos
humanos. A equipe decide o que versionar.
No repositório do kit, o código do produto fica em
`src/`, `bin/`, `tests/` e `scripts/release/`, na raiz.
Use `agents` para consultar, `agents add <id>` para acrescentar e
`agents remove <id>` para retirar clientes. `none` prepara apenas o hub e
`AGENTS.md`. `all` inclui os clientes ativos.
O hub fica completo; clientes podem compartilhar pastas necessárias.

| Pasta | Para que serve |
| --- | --- |
| [skills](skills/README.md) | Procedimentos de tarefas e seus criadores |
| [agents](agents/README.md) | Perfis para revisão e delegação |
| [commands](commands/README.md) | Casos de uso e encaminhamento |
| [rules](rules/README.md) | Orientações aplicadas por contexto |
| [templates](templates/README.md) | Modelos para documentos futuros |
| [scripts](scripts/README.md) | Automações e seleção de ferramentas |
| [tools](tools/README.md) | Definições versionadas e instalações locais ignoradas |
| [external-skills][externas] | Catálogo curado e downloads locais |

Somente `SKILL.md`, `AGENT.md`, `COMMAND.md` e `RULE.md` em suas pastas
têm apontamentos nas ferramentas. A origem é agrupada; os destinos usam o
layout registrado. Veja a [compatibilidade](COMPATIBILIDADE.md) dos clientes.
Recursos auxiliares e guias ficam exclusivamente em `.pbai4devs`.
A licença do kit fica em `LICENSE` dentro deste hub após `init` ou `update`.
Ela vem do pacote e não substitui a licença do projeto consumidor.
Os testes das automações ficam em `scripts/<nome>/tests/`; guarde resultados em
diretório ignorado pelo projeto ou temporário fora do repositório.
O `.gitignore` desta pasta controla somente sua árvore; o kit preserva ignores,
índice e `.git/info/exclude` humanos. A migração pode retirar apenas o bloco
legado reconhecido da versão 0.0.21. Os clientes não recebem ignores novos.
Apontamentos e artefatos podem ficar visíveis no Git. Confira com `git status`
e `git check-ignore -v -- <caminho>`; `git ls-files -- <caminho>` identifica
arquivos já rastreados, que não são removidos do índice por uma regra ignore.
Use os [modelos](templates/gitignore/TEMPLATE.md) se o projeto precisar de
regras adicionais.
Use `agentdevkit plugins list` para consultar ferramentas e skills externas.
Use os respectivos guias para preparar uma instalação local ou verificar a
origem de uma entrada. [Ferramentas](tools/README.md) · [Skills externas][externas]

Os modelos acompanham cada fase. Após implementar, use `atualizar-documentacao`
e o comando `revisar-entrega` para fechar documentação, revisão e evidências.

Use o [comando sincronizar](commands/sincronizar/COMMAND.md) para atualizar os
apontamentos; o script também aceita `--check` para só conferir.
Os [exemplos de maturidade](scripts/testar-maturidade/README.md) ficam em uma
pasta temporária fora de Git, com cópias da estrutura e relatórios locais.

[externas]: external-skills/README.md

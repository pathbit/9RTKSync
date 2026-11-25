---
description: Catálogo de CLIs e ferramentas condicionais para os agentes.
---

# Ferramentas

Cada pasta mantém `TOOL.json`, `SCRIPT.mjs` e um guia.
O catálogo local `catalog.json` relaciona essas definições aos comandos
de instalação, atualização, verificação e execução. Ao editar definições,
rode `sincronizar-agentes` e `--check`; versões instaladas ficam no estado local.
Para npm, o instalador consulta `latest` e usa `--ignore-scripts`.
Scanners nativos usam versões e SHA-256 revisados em `TOOL.json`; `update`
aplica esse pin. Pacotes e estado ficam em `<nome>/.local/`; cache em
`.cache/` e atalhos em `bin/`, todos ignorados. Tools ficam só em `.pbai4devs`.

| CLI | Grupo | Uso |
| --- | --- | --- |
| [agent-browser][browser] | base | Automação web. |
| [markdownlint-cli2][lint] | base | Lint de Markdown. |
| [agent-desktop][desktop] | desktop | Automação desktop. |
| [skills][skills] | discovery | Descoberta de skills. |
| [just-bash][bash] | shell | Shell em sistema virtual. |
| [opensrc][source] | source | Fontes de dependências. |
| [webreel][video] | video | Roteiros e vídeos do navegador. |
| [portless][proxy] | proxy | Proxy e URLs locais estáveis. |
| [gitleaks](gitleaks/README.md) | security | Segredos em arquivos e Git. |
| [osv-scanner](osv-scanner/README.md) | security | Dependências com base local. |
| [opengrep](opengrep/README.md) | security | Código com regras locais. |
| [openspec](openspec/README.md) | workflow | Validação e arquivamento de deltas. |
| [dotcontext-mcp](dotcontext-mcp/README.md) | workflow | Servidor local MCP via stdio. |

`setup` instala e verifica os CLIs compatíveis da seleção geral. O grupo
`base` seleciona navegador e lint. O grupo `security` seleciona os três
scanners. As ferramentas do grupo `workflow` exigem seleção explícita pelo
nome ou pelo grupo. A seleção geral `all` pula essas entradas.

```console
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs setup workflow
```

As bases de vulnerabilidades são preparadas separadamente; instalar o CLI
não transforma uma base ausente em resultado limpo.
Confira Node/npm pelo [primeiro uso][manager] antes de executar os scripts.
O instalador usa o mesmo Node 24+ com npm em todos os sistemas. Plataformas aceitas
ficam em cada `TOOL.json`; ausência de restrição npm não comprova teste do SO.

```console
node .pbai4devs/tools/skills/SCRIPT.mjs install
node .pbai4devs/tools/skills/SCRIPT.mjs update
node .pbai4devs/tools/skills/SCRIPT.mjs check
node .pbai4devs/tools/skills/SCRIPT.mjs run --version
```

Use os mesmos comandos no macOS, Linux e Windows. `install` reutiliza
uma instalação saudável; `update` consulta `latest`; `check` verifica sem rede;
`run` executa sem instalar; `info` mostra a configuração. Sem ação, há ajuda.
`unlock <nome>` no instalador recupera somente locks locais de processos
comprovadamente encerrados; preserva locks ativos ou de origem incerta.
O [instalador comum][manager] aceita nomes ou grupos, como `setup`, `install base`,
`update video`, `check source` e `list`.

O preparo verifica o CLI; fluxos de aplicação precisam de provas específicas.
O [fluxo de segurança](../commands/auditar-seguranca/COMMAND.md) usa análise
offline e relatórios redigidos. Downloads públicos exigem rede, não conta.
Skills usa descoberta sem importação automática ou symlinks. Portless é opt-in:
o preparo não inicia proxy. Webreel exige executáveis explícitos para gravar
sem baixar recursos em `~/.webreel`; seu guia lista os overrides. Use caminhos
de estado suportados por `envPaths`, sem alterar `HOME`. Versione testes e
roteiros; resultados, vídeos e capturas ficam em `.agent-tests/`.

Outras candidatas ficam condicionadas à necessidade, com adoção após definir
produto e arquitetura; esta configuração não adiciona dependências à aplicação.

| Candidata | Quando considerar |
| --- | --- |
| [emulate][emulate] | Emular serviços usados pelas integrações e pelo CI. |
| [agent-eval][eval] | Comparar agentes com credenciais e infraestrutura. |
| [issue-graph][issues] | Consultar issues via `gh` ou Linear autenticado. |
| [konsistent][consistency] | Aplicar padrões estruturais num projeto TS. |
| [phase][performance] | Analisar performance de um frontend existente. |
| [dev3000][debug] | Depurar servidor/browser com runtime e proxy preparados. |
| [bash-tool][sdk], [AI SDK][ai] | Implementar agentes na stack aprovada. |

`next-browser` está arquivado. `before-and-after` é uma skill no código atual;
o antigo CLI npm não representa esse formato. As coleções `agent-skills` são
fontes de skills, não CLIs adicionais. Importe recursos pelo fluxo do projeto.

[browser]: agent-browser/README.md
[lint]: markdownlint-cli2/README.md
[desktop]: agent-desktop/README.md
[skills]: skills/README.md
[bash]: just-bash/README.md
[source]: opensrc/README.md
[video]: webreel/README.md
[proxy]: portless/README.md
[manager]: ../scripts/preparar-ferramentas/README.md
[emulate]: https://github.com/vercel-labs/emulate
[eval]: https://github.com/vercel-labs/agent-eval
[issues]: https://github.com/vercel-labs/issue-graph
[consistency]: https://github.com/vercel-labs/konsistent
[performance]: https://github.com/vercel-labs/phase
[debug]: https://github.com/vercel-labs/dev3000
[sdk]: https://github.com/vercel-labs/bash-tool
[ai]: https://github.com/vercel/ai

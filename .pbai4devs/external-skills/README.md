---
description: Catálogo revisado e cópias locais de skills externas.
---

# Skills externas

[CATALOG.json](CATALOG.json) registra origem, commit imutável, arquivo,
nome, licença, finalidade e revisão local. `reviewed` indica curadoria para o
uso descrito. As instruções do usuário e as regras do projeto prevalecem.
Entradas `candidate` ficam disponíveis para consulta e avaliação de origem.

Use o [gerenciador](../scripts/gerenciar-skills-externas/README.md) para listar,
descobrir, instalar, verificar ou ler uma entrada. Instale antes o CLI `skills`
pelo gerenciador de ferramentas. Node.js 24+ é o runtime comum.
Na CLI, `agentdevkit plugins list` e `plugins info <id>` mostram origem,
licença e revisão. O gerenciador detalha o preparo de uma entrada revisada.

As cópias completas ficam em `.local/<id>/`, com referências e licenças
incluídas pela origem. O CLI oficial faz o download e a cópia; nenhuma skill
é espelhada em `.pbai4devs/skills/`, pastas de clientes ou diretórios globais.
Somente catálogo, guias e automações próprias são versionados.
`licenseSource` aponta para a declaração de licença no mesmo commit, inclusive
quando ela fica na raiz do repositório e não vem junto da pasta da skill.

Atualizações exigem revisar e registrar um novo SHA no catálogo. Ler uma
skill não executa suas instruções: aplique-a somente à tarefa pertinente.
Evidências ficam em `.agent-tests/`; publicação, instalação global e fluxos
externos que alteram o projeto dependem do pedido correspondente. Spec Kit e
OpenSpec seguem seus próprios fluxos e não são iniciados por este catálogo.

As notas de cada entrada registram dependências e conteúdo remoto adicional.
O pin congela os arquivos copiados; regras buscadas depois em `main` precisam
de nova leitura antes de uso.

## Segurança local

OpenAI Security Best Practices, OpenAI Security Threat Model e GitHub Security
Review têm entradas revisadas para leitura local. O catálogo registra seus
limites: não tratar watchlists antigas como base atual nem incluir segredos nos
relatórios. O fluxo do kit usa scanners locais e não exige conta externa.
Trail of Bits Differential Review é uma referência candidata CC-BY-SA-4.0;
preserve atribuição e licença, sem copiar seu conteúdo para arquivos MIT.

Veja a [curadoria e os critérios de adoção][security].

## Outras fontes e fluxos

| Fonte | Aplicação |
| --- | --- |
| [Vercel](https://vercel.com/docs/agent-resources/skills), [CLI skills](https://github.com/vercel-labs/skills) | Descoberta e download pelo CLI já preparado. |
| [Cloudflare](https://github.com/cloudflare/skills), [APIs de skills](https://developers.cloudflare.com/agents/tools/skills/) | Catálogo local e APIs do runtime são recursos distintos. |
| [Microsoft](https://github.com/microsoft/skills), [Anthropic](https://github.com/anthropics/skills), [OpenAI](https://github.com/openai/skills) | Referências por tarefa; confira licença e dependências de cada pasta. |
| [Oracle](https://github.com/oracle/skills) | Candidatas para banco e Graal; uso depende da stack. |
| [Tech Leads Club](https://github.com/tech-leads-club/agent-skills) | Fonte comunitária; revisar licença e destinos de evidências. |
| [Spec Kit](https://github.github.com/spec-kit/), [código](https://github.com/github/spec-kit) | Aproveitar fases, artefatos e convergência; o CLI Python/uv fica fora do runtime Node adotado. |
| [OpenSpec](https://openspec.dev/), [código](https://github.com/Fission-AI/OpenSpec) | Fluxo próprio de proposal/design/tasks/verify; `init` depende de decisão explícita porque altera o projeto. |
| [Dotcontext](https://github.com/vinilana/dotcontext), antigo [AI Coders Context](https://www.npmjs.com/package/@ai-coders/context) | Avaliar manualmente o fluxo PREVC e `.context`; CLI, MCP, harness e hooks opcionais podem alterar destinos. |

As entradas revisadas de Microsoft, Anthropic e OpenAI estão identificadas no
catálogo. Vercel Writing Guidelines deve contribuir apenas com princípios
editoriais compatíveis: seus padrões de MDX/TypeScript e atribuição de agentes
não substituem os padrões locais de Markdown, Node e autoria Git.

[security]: https://github.com/pathbit/AgentDevKit/blob/main/docs/guides/security-references.md

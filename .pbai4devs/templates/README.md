---
description: Modelos por fase e manutenção dos documentos do projeto.
---

# Modelos

Ordem: preparação → PRD → UX/UI → design → roadmap → spec e plano aprovados →
configuração técnica → implementação e revisão → release.
Use as skills correspondentes para reunir respostas e preencher os modelos.
Arquivos nesta pasta são bases, não documentos aprovados. Não crie `docs/`
enquanto o usuário estiver preparando somente a estrutura dos agentes.

| Modelo | Começar em | Evoluir quando |
| --- | --- | --- |
| [README raiz][readme] | Preparação | Fase, uso ou capacidade mudar. |
| [README de pasta][pasta] | Criação da pasta | Entradas ou finalidade mudar. |
| [AGENTS][agentes], [CLAUDE][claude] quando selecionado | Preparação | Estrutura ou cliente mudar. |
| [Entradas raiz][entrypoints] | Instalação | Cliente mudar. |
| [Configuração][config] | Preparação | Produto e stack forem definidos. |
| [Arquivos raiz][raiz] | Configuração | Contratos mudar. |
| [Gitignore][ignore] | Preparação | Artefatos ignorados mudar. |
| [PRD][prd] | Produto | Escopo ou critérios de sucesso mudarem. |
| [UX/UI][ux], [design][design] | Após PRD, na ordem de trabalho | Jornadas ou arquitetura mudarem. |
| [Roadmap][roadmap] | Após design | Incrementos ou prioridades mudarem. |
| [ADR][adr] | Design | Decisão estrutural for aceita/substituída. |
| [Ambiente local][ambiente] | Configuração | Stack ou setup mudar. |
| [Levantamento de legado][levantamento] | Documentar sistema em uso | Surgirem evidências ou dúvidas novas. |
| [Contribuição][contrib] | Configuração | Fluxo de desenvolvimento mudar. |
| [Spec][spec], [plano][plano] | Planejamento da entrega | Escopo, critérios ou execução mudarem. |
| [Tarefas][tasks] | Implementação aprovada | Execução ou provas mudarem. |
| [Revisão de entrega][revisao] | Implementação | Antes de commit/merge. |
| [Release][release], [CHANGELOG][changelog] | Primeira entrega | Publicar. |
| [SECURITY][security] | Suporte público | Política/suporte mudar. |
| [Revisão de segurança][security-review] | Análise autorizada | Ameaças e provas. |
| [Comando][comando] | Recurso agêntico | Entrada ou fluxo mudar. |

Antes, inventarie e leia os documentos existentes com `atualizar-documentacao`.
Use os modelos como lista de lacunas. Copie somente artefatos aplicáveis ainda
ausentes; nunca substitua documentos existentes. Remova placeholders e confirme
fatos nos novos arquivos; preserve nomes, formatos, seções e decisões anteriores.
README acompanha o projeto desde a preparação; documentos de produto surgem
após descoberta. Segurança depende de suporte e canal realmente definidos.

Critérios de spec usam IDs AC-001. O código dos testes é versionado; resultados
ficam em `.agent-tests/<referencia>/<execucao>/`. O único relatório de revisão
é o JSON gerado pelo script; o modelo explica o contrato, sem duplicá-lo em MD.
Baseline e selo são metadados gerados para detectar alterações posteriores.
Modelos, configurações e relatórios não são espelhados nas pastas dos agentes.

[readme]: readme-projeto/TEMPLATE.md
[pasta]: readme-pasta/TEMPLATE.md
[agentes]: instrucoes-agentes/TEMPLATE.md
[claude]: claude/TEMPLATE.md
[entrypoints]: entrypoints/
[config]: configuracao/TEMPLATE.md
[raiz]: configuracao-raiz/TEMPLATE.md
[ignore]: gitignore/TEMPLATE.md
[prd]: prd/TEMPLATE.md
[roadmap]: roadmap/TEMPLATE.md
[ux]: ux-ui/TEMPLATE.md
[design]: design/TEMPLATE.md
[adr]: adr/TEMPLATE.md
[ambiente]: ambiente-local/TEMPLATE.md
[levantamento]: levantamento-legado/TEMPLATE.md
[contrib]: contribuicao/TEMPLATE.md
[spec]: spec/TEMPLATE.md
[plano]: plano-implementacao/TEMPLATE.md
[tasks]: tasks/TEMPLATE.md
[revisao]: revisao-entrega/TEMPLATE.md
[release]: release/TEMPLATE.md
[changelog]: changelog/TEMPLATE.md
[security]: seguranca/TEMPLATE.md
[security-review]: revisao-seguranca/TEMPLATE.md
[comando]: comando/TEMPLATE.md

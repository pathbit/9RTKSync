---
name: criar-recurso
description: Encaminha criações e cria documentos, modelos ou novos recursos.
---

# Criar recurso

Se o pedido for um modelo, trabalhe em `.pbai4devs/templates/` sem iniciar a
definição do produto. Encaminhe documentos reais à skill correspondente.
Para documentos, comece pelo inventário e plano de `atualizar-documentacao`.

Confira se o recurso já existe e use a skill específica quando disponível:
`criar-skill`, `criar-agente`, `criar-comando`, `criar-regra`, `criar-prd`,
`criar-ux-ui`, `criar-design-doc` ou `criar-spec`. Preserve os pré-requisitos.
Para conhecimento de fornecedores, consulte `usar-skills-externas` e reutilize
o catálogo curado, mantendo downloads fora das instruções versionadas.

Para os demais tipos, esclareça finalidade, público, saída e dúvidas que afetam
as decisões. Crie só o necessário: `.pbai4devs/<tipo>/<nome>/<TIPO>.md` para
recursos dos agentes; `.pbai4devs/templates/<nome>/TEMPLATE.md` para modelos;
documentos reais no destino acordado, somente quando o projeto começar.
Em cada Markdown novo, inclusive modelos, inclua frontmatter YAML adequado e H1.
Scripts e configurações usam seu formato próprio na mesma organização por nome.
Scripts de suporte seguem `executar-script`: escreva `.mjs` para Node.js 24+,
reutilizando o código comum, sem variantes por sistema operacional.
Código da aplicação segue `implementar-spec`.

Ferramentas usam `.pbai4devs/tools/<nome>/TOOL.json` e um `SCRIPT.mjs` fino que
delegam a `preparar-ferramentas`. Defina origem oficial, método de download,
atualização, plataformas e probe; não duplique o instalador. Só as definições,
scripts e guias são versionados; pacotes e registros ficam em `.local/`.
Use `envPaths` só para diretórios suportados pela aplicação, sem alterar `HOME`.

Mantenha instruções curtas e use referências para detalhes opcionais. Use
`verificar-trabalho` para escolher e executar as provas aplicáveis. Siga as
regras de estrutura e qualidade; atualize os índices se mudar o inventário.
Ao criar uma pasta de primeiro nível em `.pbai4devs`, inclua um README curto sobre
finalidade, itens e momento de uso. Espelhe apenas skills, agentes, comandos e
regras; modelos, scripts, ferramentas locais, estado e guias ficam em `.pbai4devs`.
Confira se as novas fontes são permitidas pelos `.gitignore` locais. Para novos
tipos ou arquivos nativos, atualize os [modelos](../../../templates/gitignore/TEMPLATE.md).
Finalize com `sincronizar-agentes` e `--check`. Documentos e recursos auxiliares
nunca são espelhados. Informe o arquivo e as pendências.

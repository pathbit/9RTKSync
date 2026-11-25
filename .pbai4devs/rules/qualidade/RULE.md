---
trigger: always_on
description: Padrões de testes, evidências e Markdown do projeto.
---

# Qualidade

Versione código de testes e fixtures em `tests/`; testes da infraestrutura de
agentes ficam em `.pbai4devs/scripts/<nome>/tests/`. Não versione
resultados, relatórios, capturas ou artefatos temporários: use `.agent-tests/`,
diretórios ignorados ou uma pasta temporária fora do repositório. Informe as
verificações necessárias que não puder executar.

Use `verificar-trabalho` para provar as mudanças. Alterações web exigem testar
o fluxo real no navegador; desktop exige abrir e testar a aplicação. Código
revisado, build ou fixture isolada não substituem essa prova funcional.

Comece novos arquivos Markdown com frontmatter YAML adequado ao tipo e título
H1; preserve os metadados exigidos pela ferramenta. Em documentos humanos
existentes, mantenha o formato e o conteúdo: não os reformate apenas para
impor esse padrão.

O `.gitignore` da raiz pertence ao projeto e não é alterado pelo kit. O
[modelo de gitignore](../../templates/gitignore/TEMPLATE.md) é opcional para
regras do projeto. `.pbai4devs/.gitignore` controla o hub; o gerador protege
os derivados externos no Git local. Sem Git, essa proteção fica pendente até
`git init` e sincronização, antes de adicionar arquivos ao índice.
Confira com Git tanto os arquivos permitidos quanto os artefatos ignorados.
Scripts compartilhados devem ser versionados; resultados locais, ignorados.
Ignore o conteúdo baixado de tools, preservando `TOOL.json`, scripts próprios
e guias. Não esconda scripts, fixtures ou templates por nome genérico ou
extensão. Qualquer arquivo ou pasta `.playwright*` fica ignorado, em qualquer
caixa, inclusive `.playwright-mcp`.

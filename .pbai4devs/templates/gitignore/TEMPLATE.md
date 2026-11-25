---
description: Exemplo opcional de regras de ignore para o projeto.
---

# Custom ignore

O `.gitignore` da raiz pertence ao projeto; o kit não o cria nem o altera.
O projeto pode adotar este exemplo e seus próprios padrões se desejar.
O `.gitignore` do hub não alcança pastas irmãs com `../`. O kit preserva os
ignores existentes, o índice e `.git/info/exclude`; confira a visibilidade com
`git status` e `git check-ignore -v` e ajuste as regras do projeto quando
necessário. Pastas de clientes podem conter arquivos humanos e dados privados.
Arquivos já rastreados permanecem no índice; o kit não os desindexa.
Para Copilot CLI, preserve `.github/copilot/settings.json` como configuração
da equipe e ignore a versão `settings.local.json`. Se `COPILOT_HOME` apontar
para dentro do projeto, ignore o diretório pessoal escolhido.
Ignore binários baixados por local, não por extensão: `.bat`, `.exe` e outros
arquivos podem ser scripts ou fixtures necessários. Não use regras genéricas
como `Release/`, `Scripts/` ou `Lib/` que escondam fontes e modelos.
Ignore qualquer arquivo ou pasta `.playwright*`, em qualquer combinação de
maiúsculas/minúsculas, inclusive `.playwright-mcp`.

```gitignore
# ---------------------------
# CUSTOM IGNORE
# ---------------------------

## Ajustes locais do Copilot CLI
/.github/copilot/settings.local.json

## Testes e artefatos locais de agentes
/.[Aa][Gg][Ee][Nn][Tt]-[Tt][Ee][Ss][Tt][Ss]/

## Resultados e relatórios de testes
[Tt][Ee][Ss][Tt][Rr][Ee][Ss][Uu][Ll][Tt][Ss]/
[Tt][Ee][Ss][Tt]-[Rr][Ee][Ss][Uu][Ll][Tt][Ss]/
.[Pp][Ll][Aa][Yy][Ww][Rr][Ii][Gg][Hh][Tt]*
[Pp][Ll][Aa][Yy][Ww][Rr][Ii][Gg][Hh][Tt]*/
[Bb][Ll][Oo][Bb]-[Rr][Ee][Pp][Oo][Rr][Tt]/

## Temporary folder and files
**/[Tt][Mm][Pp]
**/[Tt][Ee][Mm][Pp]
```

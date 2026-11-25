---
name: criar-comando
description: Cria ou atualiza comandos compartilhados e seus apontamentos.
---

# Criar comando

Trate comandos como entradas de casos de uso. Crie ou atualize
`.pbai4devs/commands/<nome>/COMMAND.md` pelo
[modelo](../../../templates/comando/TEMPLATE.md): ajuste descrição e H1,
remova `status: modelo` e defina entrada, padrões, pré-requisitos, execução e
saída. Reúna dúvidas que alterem esses contratos antes de executar.

Reutilize skills para decisões e perfis para responsabilidades. Informe
quem recebe a saída, com quais provas e em que condição. Indique os nomes e
argumentos dos scripts `.mjs` e use `executar-script` com Node.js 24+.
O seletor direto não exige npm por si só; verifique os pré-requisitos do
bootstrap e do script alvo separadamente.
Referencie ferramentas e pastas necessárias; não copie código, binários ou
instruções. Confira os contratos dos scripts e skills referenciados antes de
restringir argumentos; não declare rejeições que não tenham sido verificadas.
Confira a saída completa, incluindo mensagens do executor, `stdout`, `stderr`,
código de saída e efeito de `--raw`; não descreva só a saída do script como se
fosse toda a saída do comando. `--raw` e `--plan` antes do alvo são opções do
executor; depois do alvo, são argumentos do script. `--plan` não executa o
alvo. Documente essa distinção sem proibir opções válidas; não generalize o
canal de erros além do que foi verificado. Preserve argumentos e documentos.

Quando aplicável, confira o prompt nativo gerado em `.github/prompts/`: ele
contém apenas metadados, H1 e o link para a origem. O manifesto é gerado; não o
edite à mão. Não prometa importação ou execução automática pelo Markdown.

Atualize índice/guia, siga as regras de estrutura e qualidade e finalize com
`sincronizar-agentes`, inclusive após renomear ou remover comandos. Confira os
argumentos e a descoberta; informe quando a leitura precisar ser explícita.

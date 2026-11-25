---
name: git-commit
description: Cria um commit com alterações selecionadas do usuário.
---

# git-commit

Confira o estado, o diff, as alterações preparadas e as identidades efetivas
com `git var GIT_AUTHOR_IDENT` e `git var GIT_COMMITTER_IDENT`. Para consulta
sem escrita com preservação exata dos bytes do índice, não presuma que status
ou diff sejam seguros: use método comprovado para o repositório ou informe a
limitação. Não execute comandos de escrita quando o pedido for apenas consulta.
Siga a regra
compartilhada `.pbai4devs/rules/git/RULE.md` para identidade, mensagem e assinatura.
Autor e committer devem ser o usuário; não atribua autoria ou coautoria a
agentes de código nem adicione identificação deles à mensagem.
Prepare somente arquivos autorizados e avaliados na revisão da entrega; não
remova alterações do índice sem autorização. Uma edição não preparada pode
permanecer fora do commit sem remover a versão preparada. Consulte o comando
`.pbai4devs/commands/revisar-entrega/COMMAND.md` e, após preparar o índice,
use o seletor para `revisar-entrega check-commit <relatorio> [outros-relatorios...]`:

```sh
node .pbai4devs/scripts/revisar-entrega/SCRIPT.mjs check-commit <relatorio>
```

Substitua `<relatorio>` pelo caminho do arquivo e acrescente outros relatórios
como argumentos. Todos os arquivos staged devem ter revisão selada.
Sem consultar relatórios ou histórico, informe que eles não foram verificados.
Se falhar ou o índice mudar, interrompa e refaça a verificação. Crie o commit
somente com critérios, documentação e revisão aprovados. Confira autor,
committer e mensagem;
não inclua trabalho
incompleto ou alterações alheias.

---
trigger: always_on
description: Estrutura mínima e ambiente local dos projetos com Docker Compose.
---

# Ambiente local

Na configuração técnica de projetos novos, mantenha `.pbai4devs/` e gere apenas
os clientes selecionados. Configure `.vscode/` quando esse editor for adotado.
Para a aplicação, crie `src/`, `tests/` e `infra/compose/compose.local.yml`.
São obrigatórios `.gitignore`, `.gitattributes`, `.editorconfig`,
`.dockerignore`, `Makefile` e `README.md`; `scripts/` é opcional para automações
da aplicação. Em projetos existentes, preserve a organização até uma
padronização autorizada e siga os comandos da stack em uso.

Use Docker Compose em projetos novos e nos existentes que já o adotam.
Esclareça serviços e versões,
bancos, cache, filas, integrações, recursos, segredos, portas e dados existentes.
Pergunte a porta de entrada; se o usuário não souber, escolha uma livre e
registre-a. Publique somente o necessário em localhost, com healthchecks e
persistência explícita. Preserve volumes; não execute `down -v` como rotina.

Traefik é opcional para compartilhar a porta de entrada entre aplicações com
hosts distintos. Use configuração de arquivo ou proxy restrito para descoberta;
não exponha dashboard nem acesso irrestrito ao socket Docker.

Quando o Makefile fizer parte da configuração técnica, ele deve oferecer
`help`, `doctor`, `setup`, `up`, `down`, `logs`,
`test`, `lint` e `build`, com comandos reais da stack. Etapas ainda indefinidas
devem falhar com mensagem útil; não simule sucesso. Documente os comandos,
dependências e URL/porta no README; valide a saúde e a configuração do Compose
quando aplicável.
Antes de existir aplicação, valide o runtime, o Compose e os serviços de
infraestrutura necessários. Build, saúde e fluxo da aplicação inexistente
permanecem pendentes; não crie código de negócio para simular essas provas. Se
uma dependência obrigatória estiver indisponível, mantenha a configuração
pendente e registre o impedimento. Após a implementação, prove a aplicação.

Use o [modelo de ambiente](../../templates/ambiente-local/TEMPLATE.md) para
perguntas e arquivos-base. Versões da aplicação seguem as decisões do projeto;
atualização de ferramentas locais não atualiza bancos ou dependências da stack.

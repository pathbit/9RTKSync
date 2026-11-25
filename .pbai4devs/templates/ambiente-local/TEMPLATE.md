---
description: Perguntas e arquivos-base do ambiente após decidir a stack.
status: modelo
---

# Ambiente local

Preencha com as respostas e arquivos existentes. Este modelo não aprova
tecnologia nem inicia o produto; copie os arquivos-base apenas na configuração
técnica autorizada e substitua todos os parâmetros antes de executar.

## Perguntas iniciais

| Tema | O que esclarecer |
| --- | --- |
| Objetivo | Projeto novo, desenvolver existente ou reparar qual erro? |
| Máquina | SO/arquitetura, Docker/Compose, recursos e restrições disponíveis? |
| Aplicação | Linguagem/runtime, versões, gerenciador, lockfiles e Dockerfile? |
| Serviços | Banco e versão, cache, filas, integrações e serviços externos? |
| Acesso | Porta desejada, aplicações/hosts e necessidade de Traefik? |
| Dados | Credenciais, volumes existentes, migrações e dados que preservar? |
| Verificação | Comandos de build/test/lint, saúde e fluxo real a provar? |

Se a porta for desconhecida, escolha uma livre após verificar conflitos e
registre a decisão. Segredos ficam fora do Git; exemplos contêm só nomes e
valores fictícios. Imagens e versões seguem decisões da stack.

## Arquivos-base

- [Compose](compose.local.yml.template): copie para
  `infra/compose/compose.local.yml`;
  defina imagem/build, porta, healthcheck e os serviços necessários.
- [Makefile](Makefile.template): copie para `Makefile`; configure os comandos
  de build/test/lint/saúde da stack, preservando alvos existentes.
- [Dockerignore](dockerignore.template): copie para `.dockerignore` e adapte
  ao contexto de build; mantenha código, fixtures e manifests necessários.

A [regra de ambiente](../../rules/ambiente-local/RULE.md) define a estrutura
obrigatória e o uso seguro de Docker/Traefik. Nenhum destes modelos substitui
um Dockerfile real ou verifica o produto sem build e execução.

O Makefile usa [`up --wait`][up]
para aguardar saúde. O Compose usa
[variáveis obrigatórias][variaveis]
para impedir execução com parâmetros essenciais ausentes.

[up]: https://docs.docker.com/reference/cli/docker/compose/up/
[variaveis]: https://docs.docker.com/reference/compose-file/interpolation/

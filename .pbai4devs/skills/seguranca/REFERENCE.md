---
description: Segurança com scanners locais, triagem e provas de controles.
---

# Segurança local

A instalação do kit inclui skills, regras, comandos e perfis de segurança.
Os scanners são preparados por uma ação explícita; os arquivos de instrução
não iniciam auditorias, serviços ou downloads em segundo plano.

## Como os componentes trabalham juntos

O comando [auditar-seguranca][audit] organiza o trabalho. A
[skill de revisão][review] define como analisar e o [auditor][auditor] faz a
triagem contextual. O script executa ferramentas e produz evidências; as
[regras][rules] orientam todas as etapas. Veja o [catálogo de comandos](../../commands/README.md).

| Ferramenta | Pergunta que ajuda a responder |
| --- | --- |
| [Gitleaks][gitleaks] | Há indícios de segredos nos arquivos analisados? |
| [OSV-Scanner][osv] | A base local conhece falhas nas versões das dependências? |
| [Opengrep][opengrep] | O código corresponde aos padrões das regras locais? |

As ferramentas executam localmente e não exigem conta ou assinatura.
Versões revisadas e suas origens ficam nos `TOOL.json`. Downloads públicos de
binários e bases são separados da análise. A política do cliente/modelo de IA
continua sendo própria; não coloque valores secretos no contexto da conversa.

## Preparar e executar

Use Node.js 24+ e o projeto autorizado. O fluxo de
[preparar-seguranca][prepare] instala os scanners e confere seu funcionamento:

```console
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs setup security
```

Para dependências, baixe a base dos ecossistemas realmente utilizados. Exemplo
para npm; substitua por `Go` ou pela seleção suportada que corresponda ao projeto:

```console
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs update-data --ecosystems npm
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs check
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs run
```

`run` usa os três checks: `secrets`, `dependencies` e `sast`. Para limitar,
use [verificar-segredos][secrets] ou [verificar-dependencias][dependencies].
A análise usa dados locais; base ausente não autoriza enviar o projeto a uma API.
Confira no relatório a versão da ferramenta, a base e o escopo efetivamente lido.

## O que ainda precisa ser provado

O [artigo sobre falhas recorrentes][article] motiva os temas abaixo. As
verificações dependem da arquitetura e não equivalem a uma certificação.

| Tema | Prova necessária no projeto |
| --- | --- |
| Autorização no servidor | API direta recusa visitante e papel insuficiente. |
| Acesso por identificador | Usuário A não lê ou altera o recurso de B. |
| Isolamento dos dados | Policies/RLS ou Security Rules restringem o acesso. |
| Segredos | Credenciais privadas não chegam a fontes, bundles ou logs. |
| Entradas e abuso | Testes de validação, saída, upload e limites do fluxo. |

RLS é um controle de PostgreSQL usado pelo Supabase; Firebase tem Security Rules.
SDKs privilegiados podem atravessar esses controles e precisam de autorização
no servidor. Esconder um botão de administrador não protege a API.

Use [revisar-autorizacao][authorization] com identidades sintéticas distintas,
testes negativos e dados locais. Para entradas, prefira consultas parametrizadas,
codificação de saída por contexto e limites de upload; sanitização genérica não
resolve todos os casos. Teste a interface no navegador quando ela existir.
Sem aplicação executável, registre essas provas como **não verificadas**.

## Interpretar e corrigir

O runner retorna `0` sem achados, `1` com achados e `2` em falha ou verificação
incompleta. Leia o estado de cada check: não aplicável e não executado não
significam aprovado. Regras locais e formatos suportados limitam a cobertura.

O relatório fica em `.agent-tests/security/<execucao>/report.json`, sem valores
secretos. O auditor distingue suspeitas, falhas confirmadas e falsos positivos.
Use [modelar-ameacas][threats] para novos fluxos e
[corrigir-vulnerabilidade][fix] para reparar a causa com teste de regressão.
Uma credencial real exposta precisa de revogação pelo responsável; não a teste
contra serviços externos. Feche a entrega com [revisão independente][gate].

[Skills](../README.md) · [Ferramentas](../../tools/README.md)

[audit]: ../../commands/auditar-seguranca/COMMAND.md
[review]: ../../skills/seguranca/revisar-seguranca/SKILL.md
[auditor]: ../../agents/auditor-seguranca/AGENT.md
[rules]: ../../rules/seguranca/RULE.md
[gitleaks]: ../../tools/gitleaks/README.md
[osv]: ../../tools/osv-scanner/README.md
[opengrep]: ../../tools/opengrep/README.md
[prepare]: ../../commands/preparar-seguranca/COMMAND.md
[secrets]: ../../commands/verificar-segredos/COMMAND.md
[dependencies]: ../../commands/verificar-dependencias/COMMAND.md
[authorization]: ../../skills/seguranca/revisar-autorizacao/SKILL.md
[threats]: ../../skills/seguranca/modelar-ameacas/SKILL.md
[fix]: ../../skills/seguranca/corrigir-vulnerabilidade/SKILL.md
[gate]: ../../commands/revisar-entrega/COMMAND.md
[article]: https://manodeyvin.com.br/p/5-vacilacoes-de-seguranca-que-a-ia

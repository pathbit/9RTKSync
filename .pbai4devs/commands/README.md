---
description: Casos de uso para acionar skills, scripts e ferramentas compartilhadas.
---

# Comandos

Escolha o primeiro comando pelo resultado no [guia de uso](../INSTRUCTIONS.md).
As etapas seguintes e o que repassar ficam no próprio caso de uso.

Cada `<nome>/COMMAND.md` é a entrada de um caso de uso: informa entrada,
pré-requisitos, execução e saída. A skill orienta as decisões; o script executa
a automação; a ferramenta fornece a capacidade. Referencie-os sem copiar suas
instruções ou implementação. Pastas indicam onde ler ou salvar arquivos.

- [diagnosticar](diagnosticar/COMMAND.md): identificar ambiente e projeto.
- [preparar-dev](preparar-dev/COMMAND.md): preparar ou reparar a máquina.
- [instalar-ferramentas](instalar-ferramentas/COMMAND.md): conferir Node/npm,
  instalar e validar ferramentas em um fluxo.
- [atualizar-ferramentas](atualizar-ferramentas/COMMAND.md): atualizar ferramentas.
- [sincronizar](sincronizar/COMMAND.md): manter os apontamentos dos agentes.
- [verificar-agentes](verificar-agentes/COMMAND.md): conferir recursos e testes.
- [revisar-entrega](revisar-entrega/COMMAND.md): fechar documentação e provas.
- [testar-navegador](testar-navegador/COMMAND.md): provar um fluxo web real.
- [status-roadmap](status-roadmap/COMMAND.md): consultar o andamento.
- [proximos-passos](proximos-passos/COMMAND.md): orientar a próxima ação útil.

## Fluxos de entrega e segurança

- [planejar-entrega](planejar-entrega/COMMAND.md): reunir dúvidas e planejar.
- [implementar-entrega](implementar-entrega/COMMAND.md): executar o plano aprovado.
- [validar-entrega](validar-entrega/COMMAND.md): produzir provas por critério.
- [atualizar-documentacao](atualizar-documentacao/COMMAND.md): manter os guias.
- [preparar-seguranca](preparar-seguranca/COMMAND.md): preparar scanners e bases.
- [auditar-seguranca](auditar-seguranca/COMMAND.md): executar e triar a análise.
- [verificar-segredos](verificar-segredos/COMMAND.md): limitar a busca a segredos.
- [verificar-dependencias](verificar-dependencias/COMMAND.md): conferir pacotes.

Use `criar-comando` e o [modelo](../templates/comando/TEMPLATE.md) para novos
casos. Para automações, use [executar-script](../skills/projeto/executar-script/SKILL.md)
com o nome do script e seus argumentos, conforme o [guia](../scripts/README.md).
Argumentos vêm do usuário; `$ARGUMENTS` só existe quando a ferramenta o oferece.

O Markdown orienta o agente; não executa scripts sozinho. Peça a leitura pelo
caminho ou use o atalho nativo quando descoberto pela ferramenta.
Cada comando tem entrada e saída; não precisa corresponder a uma skill nova.
Um fluxo pode combinar vários perfis e procedimentos sem duplicar conteúdo.

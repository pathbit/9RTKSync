---
description: Executa provas da entrega e prepara a revisão independente.
---

# Validar entrega

Entrada: critérios, diff, provas existentes, ambiente e instruções de execução.
Se faltar aplicação ou ferramenta, registre os critérios afetados e prossiga
com as provas viáveis.

Acione o [validador](../../agents/validador/AGENT.md) com
[verificar-trabalho](../../skills/projeto/verificar-trabalho/SKILL.md).
Ele usa [executar-script](../../skills/projeto/executar-script/SKILL.md) e as
verificações reais definidas no projeto. Não há comando universal de testes.

Conforme o risco, envolva [QA](../../agents/engenheiro-qa/AGENT.md),
[segurança](../../agents/auditor-seguranca/AGENT.md) e
[performance](../../agents/analista-performance/AGENT.md). Cubra casos de sucesso,
limite e falha, permissões e integração quando aplicáveis. Para backend, exercite
contratos e dados; para interface, teste fluxos reais no navegador ou desktop.
Em performance, registre ambiente, carga, métricas e comparação com a meta.
Não invente metas nem marque como aprovado o que não foi executado.

Saída: resultado por critério, comandos e provas em `.agent-tests/`. Código de
teste e fixtures são versionáveis. O validador devolve falhas ao implementador
e entrega as provas ao agente principal. Com os critérios comprovados, siga
[revisar-entrega](../revisar-entrega/COMMAND.md) para fechar documentação,
revisão independente e gate.

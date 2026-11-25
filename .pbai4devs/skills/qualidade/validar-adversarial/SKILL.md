---
name: validar-adversarial
description: Confirma ou refuta hipóteses específicas de falha nos requisitos, na mudança ou nas provas.
---

# Validar adversarialmente

Leia o escopo, a mudança e as evidências. Priorize hipóteses de falha por
probabilidade e impacto. Considere dados inválidos, limites, permissões,
estados ausentes, dependências e concorrência quando aplicáveis.

Teste com dados e ambiente autorizados, preferindo isolamento e verificações
não destrutivas. Use revisão independente quando disponível e autorizada.
Caso contrário, faça segunda leitura crítica e informe a limitação. Confira o
código de saída do teste, inclusive quando filtrar a saída em um pipeline.
Encaminhe questões de segurança a
[revisar-seguranca](../../seguranca/revisar-seguranca/SKILL.md).

Relate cenário, observação, impacto, localização e confiança. Indique falhas
confirmadas, hipóteses e testes pendentes. Restrinja a conclusão à cobertura
observada e trate impactos sem exposição comprovada como condicionais.
Repita a verificação relevante após a correção.

---
name: revisar-codigo
description: Examina um diff e suas provas para apontar defeitos, regressões e lacunas de cobertura.
---

# Revisar código

Leia o diff, contratos, aceites e testes pertinentes. Atue em leitura quando
for o [revisor](../../../agents/revisor/AGENT.md). Confira a cobertura antes de
afirmar que falta um teste e preserve alterações de outras pessoas.

Priorize defeitos concretos e regressões da mudança. Considere dados,
concorrência, falhas, segurança e implantação conforme o risco. Use
[validar-adversarial](../validar-adversarial/SKILL.md) quando houver uma
hipótese específica a refutar.

Para cada achado, informe arquivo, linha, cenário, impacto e evidência.
Distinga hipóteses de fatos e limite a afirmação aos casos demonstrados.
Informe o que consultou, o que executou e os limites da revisão.

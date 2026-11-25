---
name: revisar-seguranca
description: Diagnostica riscos de segurança em código ou projeto e relata achados, prioridades e cobertura.
---

# Revisar segurança

Delimite projeto ou mudança, dados sensíveis, stack e ambiente autorizado.
Siga as regras de [segurança](../../../rules/seguranca/RULE.md) e
[execução local](../../../rules/execucao-local/RULE.md).

Use o resultado de coleta já recebido. Se houve falha, mesmo sem relatório,
registre a tentativa e a lacuna de cobertura. Se ainda não houve coleta e
a revisão exigir scanners, use o
[script local](../../../scripts/auditar-seguranca/README.md) no modo `run`
com os checks pertinentes. Use o [guia de segurança](../REFERENCE.md) para
avaliar os controles do escopo recebido mesmo quando os scanners não
detectarem sinais.

Use [revisar-autorizacao](../revisar-autorizacao/SKILL.md) para permissões,
[modelar-ameacas](../modelar-ameacas/SKILL.md) para novas fronteiras e
[validação adversarial](../../qualidade/validar-adversarial/SKILL.md) para
testes negativos com dados sintéticos quando aplicáveis. Comprove os controles
na API ou interface local conforme
[verificar-trabalho](../../projeto/verificar-trabalho/SKILL.md).

## Relatório de segurança

Encerre a revisão no diagnóstico e nas recomendações. Apresente o relatório na
conversa. Salve uma cópia em `.agent-tests/security/` quando o destino estiver
ignorado e fora do índice. Se precisar de uma cópia sem esse destino, use uma
pasta temporária privada fora do Git. Cite e preserve o `report.json` existente.
Omita segredos e dados pessoais. Use quatro seções:

1. **Resumo e escopo** com caminhos, ambiente, verificações e contagem de
   achados confirmados por gravidade. Identifique e justifique suspeitas e
   falsos positivos à parte.
2. **Achados por risco** com ID, controle, pré-condição, probabilidade e impacto.
   Justifique a gravidade crítica, alta, média ou baixa e informe confiança e
   evidência (arquivo e linha, configuração ou teste). Indique a prova faltante
   em cada suspeita.
3. **O que corrigir primeiro** com ações ligadas aos IDs, urgência pela
   exposição e pelo impacto, esforço estimado e forma de verificar a correção.
   Se houver apenas suspeitas, priorize obter evidência. Reparos autorizados
   seguem [corrigir-vulnerabilidade](../corrigir-vulnerabilidade/SKILL.md).
4. **Não avaliado** com escopo excluído, verificações incompletas, motivos e
   pré-requisitos para retomá-las. Justifique à parte os itens não aplicáveis.
   Limite a conclusão à cobertura comprovada.

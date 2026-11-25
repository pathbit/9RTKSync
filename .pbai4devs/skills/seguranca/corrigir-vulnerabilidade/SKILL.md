---
name: corrigir-vulnerabilidade
description: Corrige um achado validado e prova que a causa foi removida.
---

# Corrigir vulnerabilidade

Receba o achado e sua evidência de [revisar-seguranca](../revisar-seguranca/SKILL.md).
Confirme o caminho de abuso e o escopo autorizado. Esclareça dúvidas e apresente
o plano antes de editar, respeitando aprovações já dadas.

Corrija a causa, preserve o contrato legítimo e acrescente um teste de regressão
que falhe antes e passe depois. Não silencie regra ou exclua arquivo apenas
para deixar o scanner verde; documente falsos positivos com justificativa.
Se a correção cobrir outro cenário descoberto, acrescente também um teste
automatizado versionável para ele; uma prova avulsa apenas complementa o teste.

Use [implementar-spec](../../specs/implementar-spec/SKILL.md) quando houver spec
e [verificar-trabalho](../../projeto/verificar-trabalho/SKILL.md) para as provas.
Repita o scanner relevante e o cenário original. Mudanças web exigem navegador;
autorização exige a matriz de [permissões](../revisar-autorizacao/SKILL.md).

Se houver segredo real, não o reproduza. Informe o responsável para revogação
e rotação pelo canal apropriado; remover do código não invalida a credencial.
Não altere contas, histórico Git ou serviços externos sem escopo explícito.

Saída: correção, teste, risco residual e documentação atualizada. Feche com
[revisar-entrega](../../../commands/revisar-entrega/COMMAND.md), incluindo
revisão independente e evidências ignoradas em `.agent-tests/security/`.

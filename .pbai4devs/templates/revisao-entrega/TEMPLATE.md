---
description: Contrato do relatório executável de revisão de uma entrega.
status: modelo
---

# Revisão de entrega

O relatório real é um único JSON em
`.agent-tests/<referencia>/<execucao>/revisao.json`, sem outra cópia Markdown.
Gere-o pelo script `revisar-entrega prepare --id <referencia>`, com `--spec`
ou `--scope` conforme a mudança. Preserve o snapshot gerado pelo script.

| Campo | Contrato |
| --- | --- |
| `version` | `1`. |
| `reference`, `execution` | Identificadores da mudança e da execução. |
| `spec` | Caminho da spec ou `null` para mudança sem spec. |
| `snapshot` | Modo, HEAD, hashes, spec e documentos obrigatórios revisados. |
| `baseline` | Caminho e hash do escopo original gerado por `prepare`. |
| `documentation` | Caminho, decisão e justificativa por documento. |
| `validation` | Critério AC-001, método, pré-requisito, assertiva e provas. |
| `review` | Revisor, estado e achados do estado final. |

Decisões de documentação: `pending`, `updated`, `no-impact`, `not-applicable`.
Status de validação: `pending`, `passed`, `failed`, `not-run`, `not-applicable`.
Toda ausência de impacto/aplicação precisa de justificativa. Evidências devem
existir em caminhos relativos sob a pasta ignorada da execução; código de teste
permanece versionado. Sem spec, defina critérios próprios com IDs AC-001;
`spec: null` não dispensa os pré-requisitos para implementar funcionalidades.
O gate só aprova critérios com `passed` e evidência. Um aceite não aplicável
exige rever o escopo aprovado; marcar `not-applicable` não o dispensa.

O revisor trabalha em leitura; o agente principal registra seus achados no
JSON. `review.status` só passa de `pending` a `approved` após fechar achados
`open` como `resolved` e revisar o estado final. Alterações posteriores exigem
novo snapshot, verificações afetadas e nova revisão.
Erro de delegação ou ausência de resposta mantém a revisão pendente. O selo
confere os dados registrados; ele não comprova que a revisão aconteceu.

Execute `revisar-entrega seal <relatorio>` após a aprovação independente e
`revisar-entrega check <relatorio>` antes do commit/merge. `baseline.json` e
`seal.json` são metadados gerados, sem edição manual. O script
confere consistência, cobertura, arquivos e evidências; a revisão humana ou do
agente revisor avalia a semântica e a qualidade do resultado.

---
name: atualizar-documentacao
description: Atualiza documentos afetados e sua coerência com a entrega.
---

# Atualizar documentação

Antes de escrever, execute o [inventário do hub][inventario] e consulte
`documentation`. Se o runtime não estiver disponível, mapeie os documentos
por leitura e relate os limites. Abra os arquivos relevantes e confira
aprovações, diff e critérios da tarefa.
Reúna no início somente dúvidas que os arquivos não respondem.

Proponha por caminho: manter, complementar uma seção ou criar arquivo ausente.
Reutilize nomes, formatos, decisões, links e estrutura existentes; um documento
como `ARCHITECTURE.md` pode cumprir o papel de design sem ser renomeado.
Organize primeiro por índices e links. Não apague, mova ou substitua arquivos
para padronizá-los. Acrescente apenas fatos comprovados e preserve o conteúdo
anterior. Se houver contradição relevante sem solução nas instruções ou
evidências disponíveis, apresente os fatos e pergunte ao usuário; aguarde a
resposta antes de editar o documento afetado. Continue tarefas independentes.
Comandos divergentes não justificam criar um script: confirme a intenção e o
comportamento disponível antes de decidir o que documentar.

Use o [catálogo](../../../templates/README.md) como lista de lacunas, nunca como
substituto de um documento existente. Crie somente o que a fase e o pedido
exigem; ausência de respostas não autoriza inventar PRD, design ou aprovação.

Confira README da raiz/pastas, AGENTS/CLAUDE/GEMINI, contribuição, notas de versão,
produto/design/specs, ADRs, configuração/exemplos e comentários/docstrings
relevantes. Atualize só o que a mudança afeta; documente comportamento real,
pré-requisitos, comandos, compatibilidade e limites. Evite repetir instruções.
Segurança pública depende de suporte e canal confirmado, sem dados fictícios.

No README principal, mantenha uma seção **Pré-requisitos** perto do início.
Informe o que instalar em cada modo de uso, a versão mínima verificada e o
link oficial de download. Identifique ferramentas opcionais ou específicas
de desenvolvimento. Mantenha a seção quando a stack ou as versões mudarem.

Registre por caminho a decisão `updated`, `no-impact` ou `not-applicable`, com
justificativa, no relatório da entrega ou no resultado da tarefa. Verifique
links e exemplos; compare o conteúdo anterior e confirme que arquivos fora
do plano permanecem intactos. Repetir a tarefa não deve duplicar seções.
Código de teste é versionado, evidências ficam ignoradas.

Quando delegado, devolva ao agente principal o diff, as decisões por documento
e as provas. Em entrega ou revisão já aberta, reúna o resultado no diff final.
Se você for o agente principal e a documentação for a entrega inteira, abra
a revisão, se ainda não estiver em andamento, por
[revisar-entrega](../../../commands/revisar-entrega/COMMAND.md) para acionar
o [revisor](../../../agents/revisor/AGENT.md) em leitura. Corrija achados e
confirme o estado final antes de registrar aprovação no relatório.

[inventario]: ../../../scripts/inspecionar-projeto/README.md

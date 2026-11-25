---
name: planejar-qa
description: Planeja e executa verificações de QA orientadas a riscos e critérios de aceite.
---

# Planejar QA

Confira os documentos de produto aprovados relevantes e registre conflitos com
o cenário antes de tratar critérios derivados como decisões aprovadas.
Para cada critério de aceite, identifique o comportamento observável, riscos,
dados, pré-requisitos e ambiente. Se uma decisão impedir a prova, esclareça-a;
não invente acesso, dados ou resultados. Continue as verificações que não
dependem dessa decisão.
Não generalize o comportamento de entradas não verificadas, mesmo ao ler o
código: registre hipóteses e proponha testes com dados representativos.

Escolha casos positivos, negativos, limites, transições e regressões relevantes.
Combine testes unitários, integração, API, navegador ou desktop conforme o
produto e o risco; use ferramentas existentes e fixtures isoladas. Testes de
contrato ou mocks não substituem uma integração real não executada.

Registre para cada critério comando ou ação, resultado observado e estado
**passou**, **falhou** ou **não verificado**, com evidência e limitações.
Marque como passou somente quando os dados e asserções comprovarem o critério;
o nome e o sucesso de um teste, isoladamente, não demonstram essa cobertura.
Se apenas exemplos do critério passaram, relate-os e mantenha o critério inteiro
como não verificado até haver prova do restante.
Versione o código dos testes e salve resultados em `.agent-tests/` ou diretório
ignorado. Encaminhe hipóteses de falha à
[validação adversarial](../validar-adversarial/SKILL.md).

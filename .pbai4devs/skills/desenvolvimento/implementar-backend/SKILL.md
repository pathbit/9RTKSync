---
name: implementar-backend
description: Altera APIs, serviços ou persistência com provas dos contratos e da autorização.
---

# Implementar backend

Em tarefa coberta por uma spec, siga os pré-requisitos, o plano e o gate de
configuração de [implementar-spec](../../specs/implementar-spec/SKILL.md), mesmo
para correções pontuais. Em correção avulsa autorizada, siga o escopo, as decisões
e a stack existentes. Acione `preparar-dev` se precisar preparar o ambiente.

Esclareça lacunas sobre entradas, saídas, dados, compatibilidade e falhas.
Valide entradas, autorização por recurso e isolamento de dados. Avalie
concorrência, repetição, limites, timeout, migração e recuperação conforme o
risco. Confirme os limites dos quais a segurança depende antes de implementar.
Preserve os contratos legítimos e proteja segredos nos logs.

Prove casos normais e negativos com testes e, quando aplicável, chamadas reais
à API com dados isolados. Declare integrações cobertas apenas por mocks ou
ainda pendentes. Use [verificar-trabalho](../../projeto/verificar-trabalho/SKILL.md)
para registrar evidências por critério.

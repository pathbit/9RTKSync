---
description: Verifica um fluxo web real com ferramentas de navegador disponíveis.
---

# Testar no navegador

Entrada: URL, ações e resultado esperado. Pré-requisitos: aplicação acessível,
dados de teste e ferramenta de navegador disponível. Reúna o que faltar.

Siga [verificar-trabalho](../../skills/projeto/verificar-trabalho/SKILL.md)
para o fluxo web. Use os testes do projeto, agent-browser ou o
[executor Playwright](../../scripts/testar-navegador/REFERENCE.md), conforme
as ferramentas disponíveis. O executor MCP não é um programa Node.

Saída: asserções, console/rede, viewports e resultado por critério; relatórios
e capturas em `.agent-tests/`. Fixtures da infraestrutura não provam o produto.

---
description: Execução de cenários reutilizáveis no conector Playwright.
---

# Testar no navegador

Use quando o agente tiver `browser_run_code_unsafe` com `code` e `filename`.
O script usa a página do conector, não requer instalar Playwright no projeto.
Se a ferramenta não existir ou não compartilhar a página entre chamadas,
use os testes Playwright do projeto ou informe a limitação.

1. Abra a URL real e observe os controles pelo snapshot da ferramenta.
2. Em `browser_run_code_unsafe`, passe uma função como esta em `code`, com os
   controles e resultados observados; não coloque credenciais no cenário.

   ```js
   async (page) => {
     page.__agentsRequest = {
       url: 'http://localhost:3000',
       steps: [{ action: 'visible', role: 'heading', name: 'Título real' }]
     };
     return { ready: true };
   }
   ```

3. Execute `filename: '.pbai4devs/scripts/testar-navegador/SCRIPT.js'` na mesma
   ferramenta. Confira `passed`, cada viewport e os erros; salve o resultado
   em `.agent-tests/<tarefa>/resultado.json`.
4. Capture a tela com a ferramenta em `.agent-tests/<tarefa>/tela.png` e
   inspecione-a. Encerre somente a página ou sessão aberta para esta tarefa.

Por padrão, são usados 1280×800 e 390×844. O cenário aceita `viewports`,
`timeout` (máximo 30 segundos) e `title`. Cada passo usa `testId`, `label` ou
`role` e `name` exatos, com uma das ações:

| Ação | Dados |
| --- | --- |
| `visible`, `click` | Controle observado |
| `text`, `fill`, `select` | `value` |
| `press` | `key` |
| `check` | `checked` (padrão: `true`) |

É obrigatória uma asserção `visible` ou `text`. Console, página e rede com
erros reprovam o cenário; investigue a origem sem suprimir falhas para aprovar.
Fluxos destrutivos exigem dados e ambiente de teste apropriados, com limpeza.

Para provar só a infraestrutura, execute `tests/SUCCESS.js` desta pasta
e depois o executor; espere `passed: true`. Repita com `tests/FAIL.js`; espere
`passed: false` por erro de console. Essas fixtures não verificam o produto.

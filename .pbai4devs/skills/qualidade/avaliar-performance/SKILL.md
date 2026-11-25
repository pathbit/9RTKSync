---
name: avaliar-performance
description: Mede e investiga desempenho com carga, comparação e limites explícitos.
---

# Avaliar performance

Defina o fluxo, a métrica e o ambiente autorizados. Identifique meta existente
ou registre sua ausência; não invente orçamento nem simule carga em produção
sem autorização. Reúna volume de dados, concorrência e condições reproduzíveis.
Antes de otimizar, combine carga típica e máxima, métrica, limite e protocolo;
inclua cache, chegada de requisições e aquecimento quando relevantes. Defina
também tolerâncias para erros, recursos e correção funcional.

Meça uma linha de base e compare a mudança nas mesmas condições; registre
comandos, repetições, latência, erros, throughput e recursos conforme o caso.
Registre valores absolutos antes e depois e, quando aplicável, a incerteza da
diferença. Escolha percentis e amostras conforme a métrica e a carga; não trate
um número fixo de execuções como garantia de precisão.
Investigue o gargalo antes de otimizar e prove que o comportamento permanece.
Separe inferências de código de medições e não generalize comportamento para
entradas não verificadas; registre hipóteses e seus limites.
Sem medição e carga definidas, não classifique o custo como desprezível, rápido
ou lento; descreva apenas o comportamento observado no código.
Para web, use métricas pertinentes como LCP, INP e CLS e distinga medições
locais de dados reais de usuários: veja [Core Web Vitals](https://web.dev/articles/vitals).

Informe variação, limitações e resultado em relação à meta. Sem ambiente,
carga ou dados adequados, marque como não verificado; não extrapole uma medição
local para produção. Salve relatórios em diretório ignorado.

---
description: Recuperação de Node.js por JavaScript sem instalação global.
---

# Preparar o runtime

O inicializador usa Node.js 18+ para preparar Node.js 24+ e npm locais.
No Windows, ele seleciona uma versão com a correção de remoção em caminhos
Unicode. Use Node.js LTS 24.13.1+ ou 26+. Se o próprio processo do bootstrap
for de uma versão afetada, ele pode usar um runtime compatível no cache.
Caso contrário, atualize o Node pelo gerenciador do sistema.
Se Node/npm estiverem totalmente ausentes, o agente deve instalá-los pelo
gerenciador do sistema operacional antes de executar JavaScript ou npx.

Com Node disponível, execute na raiz do projeto:

```text
node .pbai4devs/scripts/preparar-ferramentas/BOOTSTRAP.mjs --runtime-only
```

O modo `--runtime-only` imprime `node=<caminho absoluto>` sem instalar
ferramentas. Sem opções, continua com `setup`; aceita grupo ou nome.
Para preparar o runtime, diagnosticar e executar um script em sequência, veja
[`--executar`](../executar-script/README.md). O plano e `--no-install` não
baixam o runtime; não restringem efeitos dos processos que forem executados.

O fluxo reutiliza um runtime saudável ou o cache local. Se necessário, baixa
Node 24 de `nodejs.org`, verifica SHA-256 e extrai usando `tar` nativo.
Windows usa ZIP; macOS/Linux usam tar.gz. Não há scripts Bash ou PowerShell,
mudança permanente de PATH ou instalação global neste fluxo.

Os probes preservam `NODE_OPTIONS`. Quando essa variável está preenchida,
isolam sua resposta do stdout comum. Preloads assíncronos e npm personalizado
que dependa de detalhes internos do Node ainda podem impedir a verificação.
Respostas ambíguas são recusadas sem baixar um runtime;
`--raw` não isola a saída de preloads.

O cache fica em `.pbai4devs/tools/.cache/runtime/`. Falhas de download,
integridade ou validação preservam o runtime anterior. Arquivos e links fora
da distribuição são recusados. `tar` deve estar disponível no sistema.

Navegadores, permissões desktop e FFmpeg dependem da tarefa e não são
instalados ou ativados por este inicializador.

Fonte: [distribuições oficiais do Node.js][node].

[node]: https://nodejs.org/dist/latest-v24.x/

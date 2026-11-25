---
description: Confere os indicadores registrados antes da implementação.
---

# Verificar configuração

```sh
node .pbai4devs/scripts/verificar-configuracao/SCRIPT.mjs
```

Para consultar apenas a preparação antes da spec, acrescente `--preparacao`.
Nesse modo, configuração técnica pendente não bloqueia a consulta.

Somente leitura: sem a opção, retorna `1` se o estado estiver ausente,
inacessível, ambíguo ou com preparação ou configuração pendente. Retorna `0` e
`verificar-evidencias` quando ambos os indicadores registram `concluido`. Com
`--preparacao`, o mesmo resultado exige apenas o indicador de preparação.
Para evitar ambiguidades, recusa chaves complexas e tags, âncoras, aliases ou
mesclagens no topo do cabeçalho. Links simbólicos detectados são recusados;
a leitura não é uma trava
atômica contra mudanças simultâneas de caminhos.
Não valida o YAML inteiro, a infraestrutura ou as provas; confira-os antes de
escrever. O comando não bloqueia alterações de quem ignore seu resultado.

O estado legado é reconhecido sem migração; estados em conflito são recusados.
Erros de uso retornam `2`.

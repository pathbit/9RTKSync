---
name: executar-script
description: Identifica ferramentas instaladas e executa scripts pelo interpretador compatível.
---

# Executar script

Com Node 18+ e npm, use o bootstrap para preparar Node 24+, diagnosticar e
executar o script solicitado, nessa ordem. O mínimo 24 é do Node; verifique
o npm separadamente e informe sua versão somente quando medida:

```sh
node .pbai4devs/scripts/preparar-ferramentas/BOOTSTRAP.mjs --executar <script> [argumentos...]
```

Se o diagnóstico falhar, inspecione a causa; o script não é executado. Seu
sucesso indica inventário concluído, não dependências necessariamente prontas.
`--executar --no-install`
evita apenas o download e instalação do runtime; usa o atual, o primeiro Node
do PATH ou o cache, se compatível. Não restringe o diagnóstico ou script filho.
Quando rede ou
instalações forem proibidas, só execute etapas comprovadamente compatíveis com
essas restrições ou use isolamento adequado. Sem Node/npm, instale-os pelo
mecanismo do SO quando autorizado. Preserve a operação e os argumentos pedidos.

Prefira scripts existentes. Use `--executar --plan <script>` para consultar a
execução sem instalar nem diagnosticar; o plano usa as mesmas opções de runtime.
Confira pré-requisitos, efeitos e autorização, e execute sem `--plan`.
O seletor direto continua disponível e não faz preparo nem diagnóstico.
O bootstrap reúne na saída informações do runtime, diagnóstico e execução;
identifique cada trecho antes de relatar o resultado do script.
Para redirecionar metadados e diagnóstico do kit a stderr, use `--raw` antes do
nome; erros também compartilham stderr. Sem saídas extras do ambiente, planos e
ajuda em modo raw deixam stdout vazio. Preloads em `NODE_OPTIONS` podem escrever
em stdout antes do kit; para bytes estritos, controle o ambiente sem alterá-lo
automaticamente. Argumentos após o nome pertencem ao alvo.
Consulte a [referência](../../../scripts/executar-script/README.md).

Se indicar `playwright-mcp`, use o conector conforme a
[referência](../../../scripts/testar-navegador/REFERENCE.md). Não execute esse
arquivo como Node. Sem o conector exigido, informe o pré-requisito.

Versione automações reutilizáveis e seus testes; salve somente diagnósticos,
relatórios e capturas em `.agent-tests/`. Resuma comando, resultado e falhas;
leia saídas completas apenas para investigar problemas.

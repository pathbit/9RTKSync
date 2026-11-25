---
description: Executor comum dos scripts Node do projeto.
---

# Executar script

Use Node 24+ com uma pasta ou arquivo do repositório. Nomes curtos são
procurados primeiro na raiz do projeto. Para chamar uma automação do kit,
passe o caminho explícito em `.pbai4devs/scripts/`. O comando funciona nos
três SOs:

```console
cd .pbai4devs/scripts/preparar-ferramentas
node BOOTSTRAP.mjs --executar --plan .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs
node BOOTSTRAP.mjs --executar .pbai4devs/scripts/preparar-ferramentas list
cd ../../..
```

`--executar` prepara Node/npm, diagnostica e só então chama o seletor. Falha
no diagnóstico interrompe a operação, inclusive se houver configuração de
ferramenta inválida sem relação com o alvo; inspecione a falha. Diagnóstico com
sucesso indica inventário concluído, não que todas as dependências do alvo estão
prontas. Com `--no-install`, o bootstrap usa o runtime atual, o primeiro Node
do PATH ou o cache, desde que compatível, sem baixar ou instalar o runtime.
Essa opção não restringe rede nem
instalações pelo diagnóstico ou script filho. O plano também não baixa, instala
nem diagnostica, e usa as mesmas opções de runtime.
O alvo, seus argumentos e o código de saída são preservados.
Na saída padrão, `--executar` reúne o caminho do runtime, o diagnóstico, o
cabeçalho do seletor e a saída do alvo; ela não é um JSON único nem uma saída
bruta do alvo. O seletor direto também inclui seu próprio cabeçalho.

Use `--raw` antes do nome do script para enviar ao stderr os metadados e o
diagnóstico do kit, mantendo a saída do alvo em stdout:

```sh
node .pbai4devs/scripts/executar-script/SCRIPT.mjs --raw .pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs
cd .pbai4devs/scripts/preparar-ferramentas
node BOOTSTRAP.mjs --executar --raw .pbai4devs/scripts/inspecionar-projeto/SCRIPT.mjs
cd ../../..
```

Nesse modo, runtime, plano, diagnóstico e cabeçalho vão a stderr, junto dos
erros do alvo; stderr pode conter formatos misturados. Sem outras saídas do
ambiente, `--raw --plan` e `--raw --help` deixam stdout vazio e mostram o plano
ou ajuda em stderr.
Opções depois do nome pertencem ao alvo, inclusive `--raw` e `--plan`.

Preloads ou instrumentação do ambiente, como `NODE_OPTIONS`, podem escrever em
stdout antes de o kit processar `--raw`, inclusive em plano ou ajuda, ou
interferir na identificação do runtime. Para processar bytes estritos, controle
esse ambiente; o kit preserva `NODE_OPTIONS` e não o remove automaticamente.

Com Node 24+ já disponível, o seletor pode ser chamado diretamente:

```console
node .pbai4devs/scripts/executar-script/SCRIPT.mjs --plan .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs list
```

`--plan` mostra o arquivo sem executá-lo. Os argumentos e o código de saída
são preservados; falhas não tentam outro runtime. Scripts shell/Python e links
simbólicos são recusados. Arquivos `.js`/`.cjs` existentes usam o mesmo Node.

Com Node 18+, o [bootstrap JavaScript](../preparar-ferramentas/BOOTSTRAP.md)
aceita `--runtime-only` e prepara Node 24+ antes da operação solicitada.
Sem Node/npm, o agente instala primeiro o runtime pelo mecanismo do SO.
O modo padrão do bootstrap prepara também as ferramentas; reserve-o ao setup.

`testar-navegador` mantém o executor Playwright indicado em `SCRIPT.conf`;
sem `--plan`, retorna 69 para o agente usar o conector, sem executar o arquivo.
Quando presente, `SCRIPT.conf` exige uma única entrada `executor=node` ou
`executor=playwright-mcp`; comentários `#` são permitidos. Configurações vazias,
desconhecidas ou duplicadas falham antes de executar qualquer script.

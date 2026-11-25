---
description: Instalação, atualização e execução das ferramentas locais.
---

# Preparar ferramentas

O [catálogo](../../tools/README.md) é descoberto pelos arquivos `TOOL.json`.

## Primeiro uso

Peça ao agente `instalar-ferramentas`. Ele segue o
[preparo automático](BOOTSTRAP.md): verifica Node/npm, instala o runtime local
quando necessário e continua sozinho até a validação das ferramentas.
O inicializador JavaScript aceita Node 18+ e prepara Node 24+ localmente.
Sem Node/npm, o agente usa o gerenciador do SO antes de executar o kit.
Não há mudança permanente no PATH nem scripts Bash ou PowerShell.

Se Node 24+ com npm já estiver disponível, também pode executar diretamente:

```sh
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs setup
```

`setup` reutiliza instalações saudáveis e executa `check` para cada ferramenta.
Aceita `base`, grupo ou nome; sem seleção, usa `all`. Incompatibilidades na
seleção geral são informadas como não aplicáveis; pedir uma delas pelo nome
falha. Falhas de instalação/verificação são relatadas e retornam código 1.
A seleção `all` omite ferramentas com `optIn: true`. Use `setup workflow`
para preparar o grupo opcional ou `install <nome>` para um item.
Sem npm funcional, o preparo para antes de alterar as ferramentas.
Ao mover o hub, preserve suas pastas `.local` e `.cache`; `setup` reutiliza os
pacotes e cria os atalhos locais ausentes com imports relativos. Se um
arquivo ocupar o destino com conteúdo diferente, a ação informa o caminho
e preserva o arquivo.

## Operações individuais

Com runtime disponível, execute a ação diretamente. Se ele faltar, use
`node .pbai4devs/scripts/preparar-ferramentas/BOOTSTRAP.mjs --runtime-only`
e reutilize o caminho retornado; esse modo não instala ferramentas.

Na raiz do repositório:

```sh
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs list
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs install skills
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs update base
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs check all
node .pbai4devs/scripts/preparar-ferramentas/SCRIPT.mjs unlock skills
```

`info <nome>` mostra configuração e estado. `check <nome>` executa a
sondagem da instalação existente, e `run <nome> [argumentos]` chama a ferramenta.
Sem ação, há ajuda. Cada ferramenta tem uma única entrada
`SCRIPT.mjs`, executada com Node em qualquer sistema.
Na CLI do kit instalado, `plugins install <id>` e `plugins check <id>`
também usam esse gerenciador para uma ferramenta por vez.

`unlock <nome>` recupera somente um lock local com PID comprovadamente morto.
Locks ativos, de outro host ou sem metadados verificáveis são preservados.
Não aceita grupos. Um lock ausente não cria arquivos.

O requisito comum é Node.js 24+ com npm. O gerenciador usa o Node atual.
Pacotes npm usam o registro oficial com scripts de instalação desativados.
Scanners nativos usam assets oficiais do GitHub com versão e SHA-256 revisados.
`update` segue `latest` no npm e o pin do catálogo nos scanners nativos.
Os dois caminhos conferem integridade antes de executar e preservam a versão
anterior se a atualização falhar.
Permissões de binários POSIX são aplicadas somente aos caminhos declarados
em `executables` no `TOOL.json`, antes do probe.
Atualizações usam staging e preservam a versão anterior em caso de falha.
Atalhos locais recusam diretórios e arquivos simbólicos antes de escrever.
O preparo valida os CLIs. Navegador, permissões desktop e FFmpeg dependem da
tarefa; ele não inicia aplicações nem concede permissões automaticamente.
No grupo `security`, a base OSV também é separada do CLI. Use o comando
[preparar-seguranca](../../commands/preparar-seguranca/COMMAND.md) para orientar
instalação, atualização explícita dos dados e análise offline.

Testes: `node --test .pbai4devs/scripts/preparar-ferramentas/tests/TEST.mjs`.
Após instalar `skills`, `just-bash`, `opensrc`, `webreel` e `portless`, execute
`node .pbai4devs/scripts/preparar-ferramentas/tests/SMOKE_VERCEL.mjs`.
Ele prova descoberta local, shell virtual e validação de roteiro; Portless
recebe probes. Vídeo, proxy, TLS e downloads de fontes não são exercitados.
Relatórios ficam em `.agent-tests/vercel-labs/`.

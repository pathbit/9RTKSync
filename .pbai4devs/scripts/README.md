---
description: Seleção e uso das automações compartilhadas.
---

# Scripts

Pré-requisito: [Node.js 24+ com npm](https://nodejs.org/en/download),
preferencialmente uma versão LTS. Automações próprias usam `.mjs` e o mesmo
comando em macOS, Linux e Windows. Bun não faz parte do contrato validado.
Versione scripts e testes; guarde resultados em `.agent-tests/` somente se o
projeto a ignorar, ou use uma pasta temporária fora do repositório.
Prepare ferramentas locais com `preparar-ferramentas`, sem instalações globais.
O runtime da aplicação será decidido no design doc; este requisito é dos agentes.
Com Node 18+, o [bootstrap JavaScript](preparar-ferramentas/BOOTSTRAP.md)
prepara Node 24+ com `--runtime-only` ou encadeia preparo, diagnóstico e seleção
com [`--executar`](executar-script/README.md).
Sem Node/npm, o agente instala primeiro pelo mecanismo do sistema operacional.
Não há inicializadores `.sh` ou `.ps1` no kit.

Na raiz do repositório, use o caminho do script para consultar o ambiente:

```sh
node .pbai4devs/scripts/diagnosticar-ambiente/SCRIPT.mjs --no-docker-probe
```

No diagnóstico, `docker.daemonStatus` e `docker.composeStatus` são `available`,
`unverified`, `not-found` (executável ausente do PATH) ou `not-requested`
(executável encontrado, mas sondagem desativada).
Falha na consulta não comprova que o serviço está parado. A consulta usa o
contexto Docker configurado, que pode ser remoto. Para não chamar Docker, use
`--no-docker-probe` no script de diagnóstico. Os booleanos anteriores
permanecem para compatibilidade.

| Nome | Finalidade |
| --- | --- |
| `diagnosticar-ambiente` | Runtimes, pacotes e navegadores disponíveis |
| `inspecionar-projeto` | Detecta manifests, comandos e estrutura |
| `reunir-contexto-spec` | Lê os documentos configurados para uma spec |
| `verificar-configuracao` | Confere o estado antes de implementar código |
| `preparar-ferramentas` | Instala/atualiza ferramentas locais |
| `gerenciar-skills-externas` | Instala/check/read de skills curadas locais |
| `auditar-seguranca` | Scanners offline, bases locais e relatórios redigidos |
| `revisar-entrega` | Confere documentação, revisão e provas da mudança |
| `sincronizar-agentes` | Atualiza apontamentos; `--check` só confere |
| `verificar-recursos` | Estrutura Markdown, links e espelhos |
| `testar-infraestrutura` | Executa `tests/TEST.mjs` com Node |
| `testar-maturidade` | Executa cenários temporários fora de Git |
| `testar-navegador` | Cenários via conector Playwright; veja a [referência](testar-navegador/REFERENCE.md) |

## Script de infraestrutura

`testar-infraestrutura` grava cada execução em uma pasta nova de
`.agent-tests/infraestrutura/` e informa o caminho do relatório. Logs e
relatórios anteriores são preservados; links simbólicos nos diretórios de
saída e na descoberta das suítes são recusados. Consumidores do antigo
`infraestrutura/REPORT.json` devem usar o caminho informado na execução. Uma
entrada simbólica em `scripts` também interrompe a descoberta quando não for
uma suíte. O relatório usa `partial` para testes ignorados, pendentes ou sem
testes observáveis; nesse caso o comando retorna erro para impedir uma prova
incompleta de passar como completa. O relatório identifica skips por nome,
arquivo relativo e motivo, e informa quando a justificativa está ausente. Um
skip por plataforma deixa a suíte
parcial no script instalado. O fluxo de release do repositório aceita apenas
os casos listados que têm cobertura na plataforma correspondente da matriz.
No macOS, uma ACL listada ou não verificável no
diretório de saída interrompe a execução antes da gravação. As verificações
não isolam os testes nem garantem contenção contra substituições simultâneas
de caminhos ou ACLs não detectadas.

## Ferramentas locais

Cada [ferramenta](../tools/README.md) tem `TOOL.json` e um `SCRIPT.mjs`,
com ações `install`, `update`, `check`, `info` e `run`.
Esses scripts delegam ao mesmo instalador; downloads ficam em `.local/`.
`preparar-ferramentas setup` instala e verifica os CLIs compatíveis da
seleção geral. Ferramentas com `optIn: true` exigem o ID ou grupo explícito,
como `setup workflow`.
Para um grupo, use `setup base`, `install base` ou `update base`;
`check base` não instala nem consulta novas versões.
Na CLI, `plugins list` e `plugins info <id>` consultam os catálogos.
`plugins install <id>` e `plugins check <id>` delegam aos gerenciadores do hub
instalado e operam em uma entrada por vez.

O teste `preparar-ferramentas/tests/SMOKE_VERCEL.mjs` verifica CLIs opcionais
instaladas com fixtures locais. Execute com Node; resultados ficam em
`.agent-tests/vercel-labs/`. A suíte comum permanece independente desses downloads.

O seletor aceita nome ou caminho JavaScript, repassa os argumentos e preserva
o código de saída. Nomes curtos são procurados primeiro na raiz do projeto.
Para chamar uma automação do kit, use o caminho explícito em
`.pbai4devs/scripts/`. Uma falha encerra a execução com o mesmo código.
`playwright-mcp` exige o conector: seu `SCRIPT.js` é código para uma página,
não um programa Node. Novas automações usam `.mjs`; `.bun` não é necessário.
Os testes de cada script ficam em `<nome>/tests/`; confira se os diretórios de
resultados e capturas estão ignorados. Scripts, modelos e ferramentas não têm
cópias nos agentes.

Os layouts vêm de `templates/clients/ADAPTERS.json` no hub. O manifesto local
`espelhos.conf` é gerado dessa fonte. Os metadados nativos ficam ao lado dos
recursos, com frontmatter YAML sem corpo. Caminhos são relativos à raiz.
Somente os quatro arquivos principais são fontes; não registre documentos.
Use `gitignore|pasta` para registrar pastas como `.vscode`; a linha não cria
um `.gitignore` para o cliente.

`sincronizar-agentes --force` não autoriza substituir conteúdo humano. Backups
locais podem ficar em `.agent-tests/`; revise-os antes de restaurar.
`--check` não altera arquivos.
O sincronizador também gera o catálogo completo e os índices auxiliares a partir
das fontes. Helpers e testes constam como suporte, sem fingir comandos próprios.
Ignores, índice e configuração Git existentes são preservados; confira a
visibilidade dos derivados antes de adicioná-los. O estado e os índices são locais.
Os exemplos de maturidade usam cópias locais, sem downloads ou estado pessoal.

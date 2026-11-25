---
description: Projetos copiados para testar os fluxos em maturidades diferentes.
---

# Testar maturidade

Exige Node.js 24+ e Git. Na raiz do repositório:

```sh
npm run examples
npm run test:examples
node .pbai4devs/scripts/testar-maturidade/SCRIPT.mjs run
node .pbai4devs/scripts/testar-maturidade/SCRIPT.mjs run --case legado
node --test .pbai4devs/scripts/testar-maturidade/tests/TEST.mjs
```

`prepare` só gera as cópias; `run` gera e executa. Cada execução cria uma nova
pasta exclusiva no diretório temporário do sistema e informa seu caminho no
console. Por padrão são oito cenários: agentes, descoberta, planejamento,
aplicação inicial, configurada, manutenção, legado e monorepo com caminhos em
português. Use
`--case` para executar apenas um.

Os comandos npm do checkout passam `--source-only`. Esse modo usa
`npm pack --dry-run` em modo offline, com scripts desativados, para listar as
fontes publicáveis do hub. A cópia começa sem manifesto, índices, seleção
local, espelhos ou entradas do checkout. O relatório marca
`sourceMode: "package-source"`.

Ao executar o script instalado diretamente, o modo padrão é `"project"`.
Ele usa o manifesto ou a seleção salva no projeto e copia as entradas
locais com as verificações descritas abaixo.
Uma rota antiga para `.gemini` impede a execução do sincronizador da cópia.
Revise a configuração antes de testar esse layout.

O harness copia recursos e configurações reais; exclui pacotes, caches, logs,
resultados de testes, Playwright e pastas temporárias em qualquer caixa,
`.git` e nomes conhecidos de credenciais/overrides locais. Não faz varredura
semântica de segredos. Use `--output <caminho-novo>` para escolher outra pasta
inexistente com pai existente. Na origem, são aceitos `tmp/`, `temp/`,
`.agent-tests/` ou `examples/generated/` somente quando o Git confirma o ignore
e não há arquivos do destino no índice. Fora da origem, use uma pasta fora de
qualquer repositório. Se o temporário padrão estiver dentro de Git ou se não for
possível consultar o Git, a execução falha antes de copiar. Um destino deve
ser novo; execuções e projetos anteriores não são substituídos nem removidos. Cada
exemplo recebe Git local, sem commits nem identidade alterada. O diretório
gerado contém um ignore próprio como proteção adicional. Se a
preparação falhar, o índice da nova execução permanece em `preparing`.
Os processos dos cenários não herdam variáveis `GIT_*` do usuário; isso evita
que o Git do exemplo use outro diretório ou índice indicado pelo ambiente. O
fsmonitor fica desativado nas consultas e nos processos dos cenários, sem
alterar a configuração Git do usuário.
Para saída local, a consulta respeita a configuração efetiva de ignore, mas
recusa variáveis que selecionem outro repositório ou índice. O índice inteiro é
examinado: nomes Unicode ou especiais potencialmente equivalentes bloqueiam a
saída quando não é possível provar que são diferentes, inclusive em sistemas de
arquivos com regras desconhecidas. Isso pode bloquear nomes que seriam distintos;
use a saída temporária padrão nesse caso. Índices cuja resposta exceda 64 MiB
também são recusados em vez de supor que não há conflitos.
Na API, `prepareExamples({ initializeGit: false })` também funciona sem Git
para saída fora da origem: nesse caso a verificação usa apenas os marcadores
`.git` e a estrutura de repositórios bare nos diretórios ancestrais. Variáveis
`GIT_DIR` e `GIT_WORK_TREE` definidas fazem a execução falhar; um usuário ainda
pode apontar comandos Git diretamente para qualquer pasta. Escolha um
temporário privado fora de qualquer repositório. Saídas na origem continuam
exigindo Git para comprovar o ignore e consultar o índice.
O gerador verifica links, ausência de Git e identidade da saída antes e depois
das etapas, mas isso não é uma proteção atômica. Um processo concorrente com
permissão para mover diretórios ou iniciar Git na saída ainda pode redirecionar
uma escrita ou versioná-la entre verificações. Em saída local, alterar o ignore
ou executar `git add -f` também pode versionar os exemplos. Use uma área
temporária privada, sem acesso concorrente; a pasta é criada com modo 0700
quando o SO o suporta.
O hub `.pbai4devs` e os clientes registrados são copiados. O manifesto local
tem precedência. Sem ele, os templates respeitam a seleção salva.
Um estado legado sem seleção mantém a opção `all`. Sem manifesto nem estado,
a cópia trabalha só com o hub. `.vscode` exige registro. As entradas
regulares `AGENTS.md`, `CLAUDE.md` e `GEMINI.md` presentes na origem são copiadas
para a raiz. Quando uma delas é um link simbólico, a cópia não segue o destino:
ela omite a entrada original e registra seu nome em `omittedEntrypoints` no
relatório. A preparação da fixture pode gerar uma entrada própria depois.
Os templates substituem somente entradas com blocos gerenciados válidos;
entradas próprias ou editadas são preservadas. Sem estado de instalação,
as entradas existentes são copiadas sem presumir propriedade do kit.
Os testes resolvem cada apontamento pelo formato declarado do cliente e recurso.

As cópias guardam os catálogos originais em `.agent-tests/testar-maturidade/original-catalogs/`
e geram catálogos operacionais novos, sem alterar os arquivos da origem.
Arquivos da origem substituídos pela fixture ficam em `original-files/` nessa
mesma pasta. O relatório identifica cada cópia: o cenário não é um teste do
projeto original no local.
Não copiam o código do produto em `bin/`, `src/`, `scripts/` ou `tests/`,
nem essas pastas na localização antiga dentro do hub.
Executam sincronização, reparo, idempotência, verificação de recursos,
diagnóstico, inspeção e gates negativos e positivo. Com clientes selecionados,
a prova de reparo remove um espelho gerenciado da cópia. Se a seleção for só
o hub, remove o catálogo `.pbai4devs/catalog.json`. Nos dois casos, confirma que
`--check` detecta a ausência, restaura os bytes originais e repete a verificação.
O campo `syncRepair` do relatório identifica o arquivo reparado e seu log.
Em dois casos,
criação, edição, renomeação, remoção e preservação de índices alterados
exercitam o ciclo todo.
Aplicações executam testes HTTP reais em
portas efêmeras, encerradas ao fim. Legado e monorepo preservam seus arquivos.
Ferramentas copiadas ficam sem downloads: o check negativo é esperado.

O gate positivo simula o parecer para testar seu contrato; não representa
revisão humana. Estados de aprovação são dados sintéticos. Nenhum teste
certifica produção, Docker, interface visual ou outro sistema operacional.

Índice e relatório ficam em `README.md` e `REPORT.json` na pasta informada.
Logs e provas ficam em `.agent-tests/` dentro de cada exemplo, todos ignorados.
Cada fixture cria `.agent-tests/.gitignore` para proteger esses artefatos sem
alterar o `.gitignore` copiado do projeto.

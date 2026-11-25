---
description: Analise local de segredos, dependencias e padroes de codigo.
---

# Auditar segurança

Requer Node.js 24+ e ferramentas preparadas com `setup security` no gerenciador.
O comando nunca instala ferramentas e não envia fontes para serviços remotos.

```console
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs check
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs update-data --ecosystems npm,Go
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs run
node .pbai4devs/scripts/auditar-seguranca/SCRIPT.mjs run --checks secrets,sast
```

`run` usa um snapshot de texto sem seguir links. Exclui binários, diretórios
gerados e configurações que poderiam suprimir achados. O relatório registra
as exclusões. `--target` restringe a uma pasta dentro do projeto;
`--include-history` acrescenta o histórico Git ao check de segredos e exige
que o destino seja a raiz desse repositório. Pastas `dist/` e `build/` também
são lidas; um bundle de texto não fica oculto por ser um artefato de build.
`examples/generated/` é excluído somente quando uma regra em `.gitignore`
idêntico ao blob do índice a ignora e o índice não contém caminhos da pasta.
Ignore global, `info/exclude` e regras apenas no working tree não a excluem.
Selecionar a pasta diretamente com `--target` também a analisa.

`update-data` baixa somente bases públicas do OSV por HTTPS, sem analisar ou
enviar o projeto. As bases ficam no cache local do scanner, com tamanho,
data e SHA-256 de integridade local. Esse hash não é assinatura do publicador.
Antes da promoção, valida ZIP/ZIP64, limites, CRC e os registros JSON OSV.
Atualizações preservam a base anterior se o download ou a promoção falhar.

As análises usam Gitleaks, OSV com `--offline` e Opengrep com regras JS/TS locais.
As regras próprias detectam entradas HTTP em `eval`, shell e consultas SQL,
além de TLS desativado; exigem triagem de contexto, não comprovam exploração.
O OSV exige bases locais dos ecossistemas detectados. Falta de ferramenta,
base ou erro de parsing gera estado incompleto, nunca aprovação.

| Saída | Significado |
| --- | --- |
| `0` | Checks concluídos sem achados; itens não aplicáveis ficam explícitos. |
| `1` | Achados para triagem. |
| `2` | Execução inválida, interrompida ou incompleta. |

Resultados redigidos ficam em `.agent-tests/security/<execução>/report.json`.
Não incluem código, matches ou valores de segredos. JSON bruto e snapshots
temporários são removidos. Um destino `--output` precisa ser novo, ignorado
pelo Git e estar sob `.agent-tests/`. A pasta de trabalho
`.agent-tests/security/` também precisa estar ignorada. A auditoria recusa
redirecionamentos Git e caminhos que possam conflitar com o índice; ela não
altera a configuração Git; desativa `fsmonitor` nas consultas e no ambiente
fornecido aos scanners.
Ao detectar troca da pasta de trabalho, a auditoria interrompe a limpeza e
preserva o conteúdo encontrado. A verificação e a remoção não são atômicas;
evite alterar essa pasta durante a execução.

O snapshot aceita até 20 mil arquivos, 10 MiB por arquivo e 256 MiB no total.
Uma base OSV pode ter até 512 MiB; ultrapassar os limites torna a execução
incompleta. A validação aceita até um milhão de entradas ZIP, 16 MiB por
registro e 2 GiB descompactados. Reduza `--target` quando necessário.
Ao terminar, reenumera o escopo: inclusão, remoção, mudança de tipo, modo ou
conteúdo durante a análise invalidam a aprovação.

Scanners não validam autorização por objeto/tenant, RLS ou Firebase Rules.
Complete o fluxo pela skill [revisar-seguranca][skill] e seus testes negativos.

[skill]: ../../skills/seguranca/revisar-seguranca/SKILL.md

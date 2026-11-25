---
description: Ordem de trabalho e manutenção dos agentes.
---

# Como usar

Comece pelo resultado pedido. O comando orienta a sequência, a skill orienta
as decisões, o perfil define a responsabilidade e o script executa a operação
com as ferramentas disponíveis. Regras e modelos dão contexto e formato.
Peça a leitura da fonte quando o cliente não oferecer o atalho.

| Situação | Por onde começar | Resultado |
| --- | --- | --- |
| Descobrir a próxima etapa | [proximos-passos](commands/proximos-passos/COMMAND.md) | Próxima ação e pré-requisito pendente. |
| Só consultar o ambiente ou fazer um projeto existente rodar | [diagnosticar](commands/diagnosticar/COMMAND.md) ou [preparar-dev](commands/preparar-dev/COMMAND.md) | Inventário ou ambiente verificado, conforme o pedido. |
| Entender e documentar um sistema existente | [documentar-legado](commands/documentar-legado/COMMAND.md) | Comportamentos, evidências e lacunas por fluxo. |
| Definir um incremento ou executar uma entrega aprovada | [planejar-entrega](commands/planejar-entrega/COMMAND.md) ou [implementar-entrega](commands/implementar-entrega/COMMAND.md) | Plano com aceites ou mudança pronta para validar. |
| Comprovar a mudança ou revisar a entrega final | [validar-entrega](commands/validar-entrega/COMMAND.md) ou [revisar-entrega][revisao] | Provas por critério ou decisão independente. |
| Revisar riscos de segurança | [auditar-seguranca](commands/auditar-seguranca/COMMAND.md) | Relatório com achados, prioridades e cobertura. |
| Evoluir os recursos do kit | [criar-recurso](skills/projeto/criar-recurso/SKILL.md) → [sincronizar](commands/sincronizar/COMMAND.md) → [verificar-agentes](commands/verificar-agentes/COMMAND.md) | Fontes reutilizadas ou ajustadas, apontamentos e provas. |

Antes de trabalhar na documentação, use `atualizar-documentacao` para inventariar
e ler os arquivos existentes. Preserve seus caminhos e conteúdo; complemente
lacunas e organize por índices, sem substituir documentos pelos modelos.

Ao instalar ou reconfigurar o kit, pergunte quais clientes o usuário usa se
não houver escolha no pedido ou no estado. A CLI aceita
`--agents codex,claude`. Consulte `agents` e use `agents add <id>` ou
`agents remove <id>` para alterar a seleção depois.
Use os IDs da [compatibilidade](COMPATIBILIDADE.md), sem deduzir o agente pelo
aplicativo, SO ou pastas. Sem resposta disponível, mantenha a escolha salva ou
`none` para preparar apenas o hub. Registre as escolhas pela CLI.

No primeiro uso, indique o objetivo com `init --purpose agents|product|run|document`
ou responda no assistente interativo quando ele abrir. Se você passou idioma e
clientes explicitamente, informe também o objetivo na CLI.
Para consultar o inventário antes de instalar, use `agentdevkit document`.

Para iniciar produto, siga a ordem abaixo. Para preparar a execução de projeto
existente, use `preparar-dev` e preserve as decisões já comprovadas.

1. `configurar-projeto`: preparar o trabalho sem iniciar código.
2. `criar-prd` e `criar-ux-ui`: definir produto e experiência.
3. `criar-design-doc`: aprovar arquitetura e tecnologia.
4. `gerenciar-roadmap`: planejar entregas e dependências.
5. `criar-spec`: exige os documentos anteriores aprovados; UX/UI pode ser
   não aplicável com justificativa aprovada.
6. `implementar-spec`: esclarecer dúvidas, aprovar plano, configurar/verificar
   o ambiente, implementar e provar os critérios de aceite.

Para novas funcionalidades, não ofereça pular as aprovações de spec ou plano.

Enquanto configurar os agentes, mantenha apenas modelos. Os documentos reais
serão preenchidos por perguntas e respostas quando o projeto começar.
Combine destinos e registre-os no estado futuro de configuração. Ao finalizar
uma etapa, explique a próxima e reúna suas perguntas. Use
[proximos-passos](skills/projeto/proximos-passos/SKILL.md) e respeite o idioma
salvo em `.pbai4devs/state/agentdevkit.json`; sem escolha, use português.
Evolua README e documentos pelos [modelos da fase](templates/README.md).
Atualize fatos e links afetados; registre ausência de impacto com justificativa.

Em projeto existente, preserve documentos e decisões comprovados. Melhorias
de estrutura e mudanças funcionais têm escopo próprio. O
[modelo de ambiente][ambiente] orienta a configuração técnica.

## Trabalho com especialistas

Quando tarefas independentes justificarem, use subagentes disponíveis e
autorizados: divida contexto, dependências, arquivos exclusivos de escrita e
provas esperadas. Integre e confira os resultados no agente principal. Antes de
encaminhar a próxima ação sugerida, confira a etapa pendente e suas evidências
com `proximos-passos`; se não puder verificá-las, informe a lacuna e inspecione.
Sem subagentes, trabalhe em sequência e informe os limites; não apresente a
própria revisão como independente. Escolha perfis por necessidade, sem impor tecnologia:
[arquitetura](agents/arquiteto/AGENT.md), [backend](agents/especialista-backend/AGENT.md),
[frontend](agents/especialista-frontend/AGENT.md), [QA](agents/engenheiro-qa/AGENT.md),
[segurança](agents/auditor-seguranca/AGENT.md) e
[performance](agents/analista-performance/AGENT.md). Validação e revisão devem
considerar falhas e cenários adversariais, além do caminho de sucesso.

## Criar e manter recursos

Use `criar-recurso`; ele encaminha à skill específica ou cria um novo tipo.
Após criar, alterar, renomear ou remover recursos, use `sincronizar-agentes`.
Isso regenera `catalog.json` e os índices auxiliares; não mantenha listas JSON
manualmente. Confira com `--check` antes de concluir a alteração.
Antes dos `.mjs`, confira Node/npm pelo [primeiro uso][preparo].
Com Node 18+ disponível, use `BOOTSTRAP.mjs --runtime-only` para preparar
Node 24+. Sem Node/npm, instale primeiro pelo mecanismo nativo do SO.
`instalar-ferramentas` usa o fluxo completo: prepara o runtime e executa
`setup` para instalar e verificar as ferramentas compatíveis.
Use Node.js 24+ com npm e os comandos de [scripts](scripts/README.md).
`executar-script` reutiliza as automações `.mjs`, iguais em todos os sistemas.
`verificar-trabalho` orienta as provas; alterações web exigem navegador.
Mudanças em acesso, dados, entradas e dependências usam `revisar-seguranca`.
O [fluxo de segurança](commands/auditar-seguranca/COMMAND.md) combina scanners
locais e análise de contexto; as skills já acompanham a instalação do kit.
Após qualquer implementação, conclua o [comando de revisão][revisao]:
documentação afetada, provas por critério e revisor independente. O relatório
fica ignorado em `.agent-tests/`; achados e provas pendentes impedem concluir.
Consulte [skills externas](external-skills/README.md) antes de reinventar um
procedimento; ative referências pela tarefa, respeitando a stack decidida.
`preparar-ferramentas` baixa/atualiza ferramentas locais para o SO/arquitetura;
cada ferramenta tem `TOOL.json` e `SCRIPT.mjs` em `.pbai4devs/tools/<nome>`.
Escolha somente as ferramentas aplicáveis ao pedido.
Binários e registros em `.local/`, cache e launchers são ignorados.

O arquivo local `espelhos.conf` registra seleção, layouts e pontos nativos.
O catálogo local `catalog.json` reúne inventário e comandos das ferramentas.
Os registros `skills.json`, `rules.json` e `agents.json` indexam as fontes.
Codex e Antigravity compartilham `.agents`; Kimi usa `.kimi-code`.
Os recursos de projeto do Copilot ficam em `.github`. A pasta
`~/.copilot` é pessoal e `.vscode` é opcional para configurações do editor.
Veja os clientes e seus limites na
[compatibilidade](COMPATIBILIDADE.md).
Só clientes selecionados recebem derivações; uma pasta compartilhada permanece
quando outro cliente precisa dela. Atualizar ou sincronizar respeita a seleção.
Somente recursos agênticos têm apontamentos; templates, scripts, tools e estado
permanecem exclusivamente em `.pbai4devs`.
O kit preserva os ignores existentes, a configuração Git e o índice. Saídas e
apontamentos podem ficar visíveis; confira o status e use os [modelos de
ignore](templates/gitignore/TEMPLATE.md) ao decidir regras para o projeto.
Documentos de produto também ficam fora dos espelhos. O comando `sincronizar`
usa a CLI para revisar e aplicar o plano; `--check` verifica sem alterações.

Os [comandos](commands/README.md) são entradas dos casos de uso: diagnóstico,
preparo local, atualização de ferramentas, sincronização e verificações.
Para consultas, leia o [comando de status](commands/status-roadmap/COMMAND.md).
Use o [revisor](agents/revisor/AGENT.md) para revisão. Links orientam a leitura;
a descoberta automática depende dos formatos de cada ferramenta.

[ambiente]: templates/ambiente-local/TEMPLATE.md
[preparo]: scripts/preparar-ferramentas/README.md
[revisao]: commands/revisar-entrega/COMMAND.md

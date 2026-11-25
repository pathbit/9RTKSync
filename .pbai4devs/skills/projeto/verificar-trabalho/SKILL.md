---
name: verificar-trabalho
description: Valida uma alteração pronta por critério de aceite com testes, execução real e evidências.
---

# Verificar trabalho

Mapeie critérios, riscos e provas disponíveis. Reaproveite evidências do mesmo
estado e ambiente que cubram o critério. Use [planejar-qa][qa] para escolher
casos e [validar-adversarial][adversarial] para investigar uma falha específica.
[executar-script][execucao] identifica os comandos reais do projeto.

- **Comportamento.** Rode os testes do projeto que cubram os aceites.
  Confira lint, tipos e build quando aplicáveis.
- **Recursos agênticos.** Rode [verificar-recursos][recursos]. Em divergências,
  [revise o plano][sync] e aplique só se a correção estiver no escopo.
- **Automações do kit.** Rode [testar-infraestrutura][infra]. Para catálogo,
  sync, instalação ou cópia, rode também [`testar-maturidade run`][maturidade].
- **Interface web.** [Abra a aplicação real][navegador], percorra os fluxos
  afetados e confira tela, console e rede na matriz do projeto.
- **Desktop ou artefato.** Abra ou renderize e inspecione o resultado.
  Execute o fluxo afetado quando houver aplicação.
- **Catálogo Vercel.** Rode o [teste funcional e confira seus limites][vercel].

Confirme resultados e códigos de saída. Marque cada critério como **passou**,
**falhou** ou **não verificado**. Um aceite de comportamento exige uma execução
que cubra o critério inteiro. Registre ambiente, comando, evidência e lacunas.
Quando faltar uma ferramenta ou acesso, indique o pré-requisito e siga com
as provas viáveis.

Arquive as saídas em `.agent-tests/<referencia>/<execucao>/` e vincule-as a
IDs como AC-001. Testes e fixtures podem ser versionados. Devolva falhas ao
implementador e encaminhe as provas ao fluxo que pediu a verificação.
Critério pendente ou revisão independente em aberto impede concluir a entrega.

[execucao]: ../executar-script/SKILL.md
[qa]: ../../qualidade/planejar-qa/SKILL.md
[adversarial]: ../../qualidade/validar-adversarial/SKILL.md
[recursos]: ../../../scripts/verificar-recursos/README.md
[sync]: ../../../commands/sincronizar/COMMAND.md
[infra]: ../../../scripts/README.md#script-de-infraestrutura
[maturidade]: ../../../scripts/testar-maturidade/README.md
[navegador]: ../../../commands/testar-navegador/COMMAND.md
[vercel]: ../../../scripts/preparar-ferramentas/README.md#operações-individuais

---
description: Validação e arquivamento de deltas com o CLI OpenSpec.
---

# OpenSpec

O plugin instala o CLI [OpenSpec, da Fission AI][source], sob a
[licença MIT][license]. O instalador obtém `@fission-ai/openspec` e verifica
o binário `openspec` com `--version`. A instalação exige seleção explícita.

Na raiz do projeto com o AgentDevKit instalado:

```console
npx @pathbit/agentdevkit plugins install openspec
npx @pathbit/agentdevkit plugins check openspec
```

Em um projeto com uma mudança OpenSpec concluída, substitua `entrega` pelo ID
da mudança e revise o delta antes de executar o arquivamento.

```console
node .pbai4devs/tools/bin/openspec.mjs validate entrega --type change --strict
node .pbai4devs/tools/bin/openspec.mjs archive entrega --yes
```

O arquivamento aplica os deltas aprovados às specs vigentes e move a mudança
para `openspec/changes/archive/`. O `--yes` confirma a escrita sem prompt.
Para adotar OpenSpec em um projeto novo, escolha e execute seu fluxo de
preparação separadamente. O plugin deixa a configuração de OpenSpec a cargo
do projeto.

[Documentação do CLI][cli] · [Ferramentas](../README.md)

[source]: https://github.com/Fission-AI/OpenSpec
[license]: https://github.com/Fission-AI/OpenSpec/blob/v2.1.1/LICENSE
[cli]: https://github.com/Fission-AI/OpenSpec/blob/v2.1.1/docs-lab/reference/cli.md

---
name: usar-skills-externas
description: Seleciona e usa skills externas curadas sem copiar instruções para os agentes.
---

# Usar skills externas

Consulte o [catálogo](../../../external-skills/README.md) antes de criar uma
solução equivalente. Escolha pela tarefa e pela stack já decidida; não adote
tecnologias para justificar uma skill. Prefira conectores e skills disponíveis.

Use `gerenciar-skills-externas list` pelo seletor. Para uma entrada `reviewed`,
execute `install <id>`, `check <id>` e `read <id>`; leia também as referências
pertinentes. A instalação fica ignorada, fora da origem e dos espelhos.
Ative só o necessário; não carregue todas as coleções no contexto.

Confirme origem, licença, revisão fixada e efeitos antes de aprovar uma entrada
ou versão nova. `update` reinstala somente o pin revisado no catálogo. Novas
instruções e scripts exigem nova revisão; não use atualizações globais do CLI.
Após mudar `CATALOG.json`, execute `sincronizar-agentes` e `--check` para manter
o inventário local atualizado; as definições são fontes, os índices são derivados.
Instruções externas se subordinam às decisões deste projeto: Node nas
automações, resultados em `.agent-tests/`, sem mudanças de stack, hooks,
publicações ou instalação de frameworks por iniciativa da skill.

Registre IDs e revisões usados no plano/revisão. Use orientações compatíveis
sem copiar o conteúdo externo para `SKILL.md` locais. Origem oficial não
substitui revisão nem significa homologação universal.

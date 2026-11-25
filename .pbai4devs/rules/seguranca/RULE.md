---
trigger: always_on
description: Preserva controles de acesso, dados e entradas durante alterações.
---

# Segurança

Ao tocar autenticação, permissões, dados, entradas ou dependências, use
[revisar-seguranca](../../skills/seguranca/revisar-seguranca/SKILL.md).
Decisões de acesso pertencem ao servidor e ao recurso, não apenas à interface.
Revise RLS/policies em PostgreSQL e Security Rules em Firebase conforme a stack.

Valide entradas, use consultas parametrizadas e codifique saídas pelo contexto.
Uploads e limites de abuso exigem regras próprias. Não trate toda chave pública
como segredo nem exponha credenciais reais em código, bundles, logs ou provas.

Scanners indicam sinais; não substituem análise e testes de autorização.
Não suprima achados sem triagem, não desative controles para fazer testes passar
e não declare segurança para um cenário não executado.

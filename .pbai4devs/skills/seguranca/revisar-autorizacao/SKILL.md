---
name: revisar-autorizacao
description: Verifica identidade, permissões por recurso e isolamento entre usuários.
---

# Revisar autorização

Identifique sujeitos, papéis, recursos e operações permitidas. Leia rotas,
middleware, políticas de dados e testes; não deduza autorização pela interface.
Se o contrato não existir, reúna as dúvidas antes de propor mudanças.
Use o idioma salvo no estado do kit. Diferencie comportamento observado de
impacto potencial e justifique a gravidade pela exposição comprovada; quando
o uso ou alcance não forem conhecidos, informe essa limitação.

Confira autenticação e autorização no servidor em cada operação sensível,
incluindo IDs manipuláveis, operações em lote e ações administrativas.
Em PostgreSQL/Supabase, revise RLS, policies, papéis e acessos privilegiados.
Em Firebase, revise Security Rules e SDKs privilegiados; são controles distintos.

Com contas sintéticas no ambiente local autorizado, prove no mínimo:

- Visitante não autenticado recebe a recusa prevista.
- Usuário A acessa seu recurso e não acessa o de B trocando o identificador.
- Usuário comum não obtém a ação administrativa pela API direta.
- Listagens, alterações e exclusões obedecem ao mesmo isolamento.

Use testes de API e, quando houver interface, navegador conforme
[verificar-trabalho](../../projeto/verificar-trabalho/SKILL.md).
Não crie contas reais nem use dados de produção para essa prova.
Sem aplicação executável ou identidades de teste, registre **não verificado**.
Entregue matriz de permissões, resultados e achados sem segredos em
`.agent-tests/security/`, usando o [modelo](../../../templates/revisao-seguranca/TEMPLATE.md).

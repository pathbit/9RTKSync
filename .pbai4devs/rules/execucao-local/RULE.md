---
trigger: always_on
description: Mantém análises locais, ferramentas abertas e evidências sem segredos.
---

# Execução local

Nos fluxos de segurança, use ferramentas open source que executem localmente,
sem conta, licença paga ou serviço remoto obrigatório. Baixar binários e bases
públicas é uma preparação explícita; analisar código é uma operação separada.

Não envie fontes, inventários ou credenciais a APIs de scanners. Desative
telemetria e consultas remotas pelo modo documentado. Se uma ferramenta ou base
faltar, registre a pendência; não troque silenciosamente por uma análise cloud.

Restrinja testes ao projeto e ambiente autorizados. Preserve configurações,
conteúdo humano e limites do cliente. Relatórios ocultam segredos e ficam em
`.agent-tests/`; binários e caches ficam nas pastas locais ignoradas.
O cliente/modelo de IA tem sua própria política de dados: mantenha valores
secretos fora do contexto e use referências redigidas na conversa.

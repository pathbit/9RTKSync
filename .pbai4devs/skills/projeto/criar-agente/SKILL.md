---
name: criar-agente
description: Cria ou atualiza perfis compartilhados de agentes e apontamentos.
---

# Criar agente

Defina papel, quando delegar, entrada, resultado, ferramentas e limites. Crie
ou atualize `.pbai4devs/agents/<nome>/AGENT.md`, com metadados apropriados e perfil
conciso. Preserve instruções e permissões existentes.
Vincule as skills pertinentes e diga ao perfil a quem devolver resultados.

Mapeie modo e permissões nos YAMLs nativos ao lado da fonte; mantenha o
cabeçalho compartilhado portátil. Quando houver suporte,
valide-os e informe diferenças de descoberta. Quando o formato não for
reconhecido, peça a leitura explícita da origem.
Para Antigravity, mantenha os YAMLs específicos junto ao `AGENT.md`.
O manifesto é gerado: não o edite à mão. A sincronização gera apontamentos.

Atualize índice/guia, siga as regras de estrutura e qualidade e finalize com
`sincronizar-agentes` pela CLI, inclusive após renomear ou remover perfis;
confira os metadados nativos gerados para cada cliente escolhido.

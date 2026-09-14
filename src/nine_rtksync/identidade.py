"""Tudo o que diferencia este painel dos irmãos, e nada além disso.

Os três sincronizadores -- 9RTKSync, OminiRTkSync e LiteLlmRTKSync -- são a
mesma aplicação. O que muda entre eles é cor, nome, logo, identidade visual e
com quem cada um conversa. Este arquivo é a fronteira: depois dele, nenhum outro
módulo do pacote escreve uma cor em hexadecimal, o nome do produto, o nome do
gateway, o prefixo de container ou o ícone da marca. Quem precisar de um desses
valores importa daqui.

A fronteira existe para poder ser verificada. `tests/test_identidade_isolada.py`
varre o pacote inteiro e reprova qualquer literal de identidade fora deste
arquivo; `tests/test_irmaos_identicos.py` compara byte a byte os módulos comuns
com os dos irmãos ao lado. Sem este arquivo os dois testes seriam impossíveis:
a divergência ficaria diluída em vinte e três arquivos, onde ninguém a vê.

Sem NENHUM import interno, de propósito: qualquer módulo pode importar daqui sem
risco de ciclo, inclusive os que o próprio `i18n` usa.
"""

# Nome do produto, como aparece na aba, no cabeçalho do painel e no `User-Agent`.
NOME_DO_PRODUTO = "9RTKSync"

# O gateway com quem este produto conversa, no texto que o operador lê.
NOME_DO_GATEWAY = "9Router"

# O mesmo gateway como slug, na coluna "Provedor" da tabela de chaves virtuais:
# quem emitiu a chave foi o próprio gateway, e deixar a célula vazia
# desalinharia a tabela das outras duas, que usam a mesma casca.
PROVEDOR_DO_GATEWAY = "9router"

# Prefixo dos containers desta pilha (`9rtk-app`, `9rtk-gateway`, ...).
PREFIXO_DE_CONTAINER = "9rtk-"

# Portas padrão. `config.py` continua lendo o ambiente: isto é só o valor de
# fábrica, não uma segunda fonte de verdade.
PORTA_DO_PAINEL = 8081
PORTA_DE_METRICAS = 9091

# Ícone da marca, do conjunto Bootstrap Icons. Nunca emoji.
ICONE_DO_PRODUTO = "bi-lightning-charge-fill"

# Desenho do ícone da aba: o(s) elemento(s) <path> de dentro do <g>. A moldura
# (viewBox, rect, transform) é comum aos três e fica em render.py. Vai o markup
# inteiro, e não só o atributo `d`, porque um dos irmãos desenha com dois
# <path>: guardar só o `d` faria o template do favicon deixar de ser o mesmo
# texto nos três.
GLIFO_DO_FAVICON = (
    "<path d='M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 "
    "8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z'/>"
)

# Fundo do favicon, já escapado para caber numa data URI. É o token `--surface`,
# e não o `--bg`: o ícone é um cartão sobre a aba, não o fundo da página.
COR_DO_FAVICON = "%23102422"

# Os nove papéis cromáticos. Existem nos três painéis com valores diferentes;
# o que NÃO pode mudar é o conjunto de papéis, porque um token a mais é um
# componente que só um painel sabe desenhar. Os tokens estruturais (`--text` e
# os `--bs-*` que fazem o Bootstrap obedecer) ficam em `render.py` com o mesmo
# valor nos três: não são identidade.
PALETA = {
    "--bg": "#091413",          # fundo da página
    "--surface": "#102422",     # cartão
    "--surface-2": "#16302d",   # cabeçalho de cartão, chip
    "--line": "#1e413d",        # borda
    "--accent": "#2fb8a4",      # ação primária
    "--accent-2": "#57d6c4",    # ação secundária, realce
    "--brand-a": "#12806f",     # marca, início do gradiente
    "--brand-b": "#2fb8a4",     # marca, fim do gradiente
    "--text-dim": "#9fb8b3",    # texto secundário
}

# Nomes dos cookies. Levam o slug do produto para que os três painéis possam
# rodar no mesmo navegador, no mesmo loopback, sem um derrubar a sessão do outro.
NOME_DO_COOKIE = "9rtksync_sessao"
NOME_DO_COOKIE_DE_ESTADO = "9rtksync_estado_sso"

# As duas chaves de tradução que dependem do que ESTE gateway faz. O catálogo de
# `i18n.py` é o mesmo texto nos três irmãos; estas duas não podiam ser, porque o
# 9Router e o OmniRoute renovam credencial OAuth e o LiteLLM apenas inspeciona --
# não há OAuth para renovar lá. Chamar os três de "agendador de renovação"
# deixaria um deles mentindo na tela.
#
# Ficam aqui, e não no catálogo, porque este é o arquivo onde mora o que muda de
# produto para produto. O `i18n.py` sobrepõe estas por cima das comuns.
ROTULOS_DO_PRODUTO = {
    "en": {
        "cron.title": "Renewal scheduler",
        "cron.result_line": "{inspected} evaluated · {refreshed} renewed ({duration}ms)",
    },
    "pt": {
        "cron.title": "Agendador de renovação",
        "cron.result_line": "{inspected} avaliadas · {refreshed} renovadas ({duration}ms)",
    },
    "es": {
        "cron.title": "Programador de renovación",
        "cron.result_line": "{inspected} evaluadas · {refreshed} renovadas ({duration}ms)",
    },
}

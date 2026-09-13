"""Renderização server-side do dashboard do 9RTKSync.

Todo o HTML é montado aqui, no servidor, com os dados já embutidos. O navegador
nunca consulta o banco: ele recebe a página pronta. Isso mantém o SQLite
inteiramente do lado do servidor e faz o painel funcionar mesmo com JavaScript
desabilitado — o jQuery serve só para conforto.

Ícones: Bootstrap Icons e flag-icons (fontes/CSS de ícones), nunca emoji.
Idioma padrão: inglês, com português e espanhol no seletor de bandeiras.
"""

import html
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..i18n import DEFAULT_LANGUAGE, LANGUAGES, normalize_language, translate

# Icone da aba, embutido como data URI: /favicon.ico responde 401 atras do
# Basic Auth, entao um arquivo servido deixaria a aba sem icone ate o
# operador autenticar -- e a pagina de erro nunca teria icone nenhum.
FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23102422'/><g transform='translate(6 6) scale(1.25)' fill='%23ffffff'><path d='M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z'/></g></svg>"

BOOTSTRAP_CSS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
BOOTSTRAP_ICONS = "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"
FLAG_ICONS = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/css/flag-icons.min.css"
BOOTSTRAP_JS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
JQUERY_JS = "https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"
# Tipografia: Google Fonts, com pilha de sistema como reserva se o CDN cair.
GOOGLE_FONTS = (
    "https://fonts.googleapis.com/css2?"
    "family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
)
FONT_STACK = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
MONO_STACK = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

# Quem emite a chave virtual. A coluna "Provedor" da tabela de chaves nao tem um
# provedor de nuvem para mostrar -- quem emitiu foi o proprio gateway -- e deixa-la
# vazia desalinharia a tabela das outras duas, que usam a mesma casca.
PROVEDOR_DO_GATEWAY = "9router"

# Teto de linhas desenhadas no cartao de modelos. Cada linha traz um modal junto,
# e o catalogo de um gateway com muitos provedores ligados passa de meio milhar
# de entradas: desenhar tudo levaria a pagina a quase um megabyte de HTML para
# uma tabela que ninguem le ate o fim. O cabecalho continua contando o total.
MAX_LINHAS_DE_MODELO = 150

# Estado semântico -> (classe do badge, ícone)
HEALTH_PRESENTATION = {
    "active": ("text-bg-success", "bi-check-circle-fill"),
    "expiring_soon": ("text-bg-warning", "bi-hourglass-split"),
    "expired": ("text-bg-danger", "bi-x-octagon-fill"),
    "rate_limited": ("text-bg-warning", "bi-pause-circle-fill"),
    "no_expiration": ("text-bg-secondary", "bi-infinity"),
    "unknown": ("text-bg-secondary", "bi-question-circle-fill"),
    # Estados vindos da validação viva da credencial.
    "invalid": ("text-bg-danger", "bi-shield-exclamation"),
    "unreachable": ("text-bg-warning", "bi-plug"),
    "not_checked": ("text-bg-secondary", "bi-dash-circle"),
}


def esc(value: Any) -> str:
    """Escapa qualquer valor para inserção segura no HTML."""
    return html.escape(str(value if value is not None else ""), quote=True)


def format_duration(seconds: Optional[int], lang: str = DEFAULT_LANGUAGE) -> str:
    """Formata uma duração em segundos de forma legível."""
    if seconds is None:
        return translate("duration.unlimited", lang)
    if seconds <= 0:
        return translate("duration.expired", lang)
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes // 60
    rest = minutes % 60
    if hours < 24:
        return f"{hours}h {rest:02d}min"
    days = hours // 24
    return f"{days}d {hours % 24}h"


def format_timestamp(value: Optional[str]) -> str:
    """Normaliza um timestamp ISO para exibição.

    Troca APENAS o "T" que separa data de hora, e não todo "T" da string. A
    versão anterior fazia `.replace("T", " ")` no texto inteiro, o que a tornava
    destrutiva ao ser aplicada duas vezes: a primeira passada produzia
    "2026-09-13 19:08:48 UTC", e a segunda comia o "T" de "UTC" e escrevia
    "19:08:48 U C" na tela. Um defeito que só aparece quando alguém formata um
    valor já formatado -- e isso é fácil de acontecer sem ninguém notar.
    """
    if not value:
        return "—"
    texto = str(value)
    if texto.endswith("Z"):
        texto = texto[:-1] + " UTC"
    # O separador ISO é o "T" na posição 10 (AAAA-MM-DDTHH:MM:SS).
    if len(texto) > 10 and texto[10] == "T":
        texto = texto[:10] + " " + texto[11:]
    return texto


def render_refresh_reason(conn: Any, refresh_margin: int, lang: str = DEFAULT_LANGUAGE) -> str:
    """Explica, em uma frase, por que a conexão foi ou não renovada.

    Sem isso o painel mostra apenas "0 renovadas" e não há como distinguir
    "nada precisava ser renovado" de "a renovação falhou".
    """
    if conn.is_local:
        # Quem diz se a instância respondeu é a sonda, não o tamanho do
        # catálogo: uma instalação nova, de pé e sem nenhum modelo baixado,
        # devolve lista vazia com HTTP 200. Contar modelos aqui a anunciava
        # como inalcançável, contradizendo o "ativa" que o próprio ciclo
        # acabara de gravar no banco.
        if conn.data.get("testStatus") == "unreachable":
            return translate("reason.local_unreachable", lang)
        models = conn.local_models
        if models:
            return translate("reason.local_ok", lang, count=len(models))
        return translate("reason.local_empty", lang)

    if not conn.is_oauth:
        return translate("reason.api_key", lang)

    remaining = conn.remaining_seconds
    if remaining is None:
        return translate("reason.no_expiry", lang)
    if remaining <= 0:
        return translate("reason.expired", lang)

    margin_min = max(1, refresh_margin // 60)
    if remaining <= refresh_margin:
        return translate("reason.inside_margin", lang, margin=margin_min)
    return translate(
        "reason.outside_margin",
        lang,
        margin=margin_min,
        eta=format_duration(remaining - refresh_margin, lang),
    )


def render_last_refresh(conn: Any, lang: str) -> str:
    """Mostra quando a credencial foi renovada pela ultima vez, e ha quanto tempo."""
    stamp = conn.last_refresh_at
    if not stamp:
        return f'<span class="text-secondary">{esc(translate("table.never_refreshed", lang))}</span>'

    ago = ""
    try:
        moment = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        elapsed = int((datetime.now(timezone.utc) - moment).total_seconds())
        if elapsed >= 0:
            ago = translate("table.time_ago", lang, elapsed=format_duration(elapsed, lang))
    except (ValueError, TypeError):
        # Carimbo de tempo em formato desconhecido vira "sem informacao" na
        # tela. Uma data ilegivel nao pode derrubar a renderizacao da pagina.
        pass

    icon = '<i class="bi bi-arrow-repeat me-1 text-success" aria-hidden="true"></i>'
    detail = f'<div class="text-secondary">{esc(ago)}</div>' if ago else ""
    return f'{icon}<span class="font-monospace">{esc(format_timestamp_curto(stamp))}</span>{detail}'


def render_remaining(conn: Any, lang: str, curto: bool = False) -> str:
    """Validade restante, sem chamar de ilimitado o que so esta faltando.

    Um token OAuth sempre expira. Quando nao ha expiresAt legivel, isso e dado
    ausente -- normalmente porque o gateway gravou a validade num formato que
    nao soube reler -- e nao uma credencial eterna. So chave estatica pode ser
    apresentada como sem expiracao.
    """
    remaining = conn.remaining_seconds
    if remaining is not None:
        return esc(format_duration(remaining, lang))

    if conn.is_oauth:
        return (
            '<span class="text-warning d-inline-flex align-items-center gap-1">'
            '<i class="bi bi-exclamation-triangle" aria-hidden="true"></i>'
            f'{esc(translate("duration.unknown_expiry", lang))}</span>'
        )
    # Na celula cabe o fato; a razao ("chave estatica") fica no modal.
    chave = "duration.no_expiry_short" if curto else "duration.no_expiry"
    return f'<span class="text-secondary">{esc(translate(chave, lang))}</span>'


def format_timestamp_curto(value: Optional[str]) -> str:
    """Data enxuta para a celula da tabela: dia/mes e hora, sem ano nem segundos.

    A forma completa ("2026-09-13 18:40:52 UTC") nao cabe na coluna e era
    cortada no meio, o que deixava a informacao pior do que util. O carimbo
    inteiro continua no modal de detalhe, a um clique da linha.
    """
    if not value:
        return "—"
    try:
        momento = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return format_timestamp(value)
    return momento.strftime("%d/%m %H:%M")


def render_notice_page(title: str, body: str, link_label: str = "") -> bytes:
    """Pagina autonoma para respostas fora do painel autenticado.

    E o que o navegador exibe quando o usuario aperta ESC no dialogo do Basic
    Auth, entao nao pode conter nem credencial nem dica de credencial.
    """
    link = (
        f'<p><a href="/">{esc(link_label)}</a></p>' if link_label else ""
    )
    return f"""<!DOCTYPE html>
<html lang="en" data-bs-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="{FAVICON}">
  <title>{esc(title)}</title>
  <link rel="stylesheet" href="{BOOTSTRAP_CSS}">
  <link rel="stylesheet" href="{BOOTSTRAP_ICONS}">
  <style>body {{ background: #091413; }}</style>
</head>
<body class="d-flex align-items-center justify-content-center" style="min-height:100vh">
  <div class="card text-center" style="max-width:34rem">
    <div class="card-body p-4">
      <i class="bi bi-shield-lock fs-1 text-secondary d-block mb-3" aria-hidden="true"></i>
      <h1 class="h5 mb-3">{esc(title)}</h1>
      <p class="text-secondary mb-3">{esc(body)}</p>
      {link}
    </div>
  </div>
</body>
</html>""".encode("utf-8")


def render_landing_page(lang: str = DEFAULT_LANGUAGE) -> bytes:
    """Pouso do retorno do provedor de identidade: "Entrando..." e vai para "/".

    NAO e um 302. Uma cadeia de redirecionamento iniciada em outro site nao
    carrega o cookie `SameSite=Strict` no salto seguinte, e o operador cairia na
    tela de login com a sessao valida no bolso -- o sintoma pareceria senha
    errada. Esta pagina e navegacao nova, e o cookie viaja nela.

    O destino e SEMPRE "/": nenhum parametro da volta vira destino, ou o login
    federado viraria um redirecionamento aberto autenticado.
    """
    lang = normalize_language(lang)
    return f"""<!DOCTYPE html>
<html lang="{esc(lang)}" data-bs-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta http-equiv="refresh" content="0;url=/">
  <link rel="icon" href="{FAVICON}">
  <title>9RTKSync</title>
  <link rel="stylesheet" href="{BOOTSTRAP_CSS}">
  <link rel="stylesheet" href="{BOOTSTRAP_ICONS}">
  <style>body {{ background: #091413; }}</style>
</head>
<body class="d-flex align-items-center justify-content-center" style="min-height:100vh">
  <div class="card text-center" style="max-width:30rem">
    <div class="card-body p-4">
      <span class="spinner-border text-secondary mb-3" role="status" aria-hidden="true"></span>
      <h1 class="h5 mb-2">{esc(translate("sso.landing_title", lang))}</h1>
      <p class="text-secondary mb-3">{esc(translate("sso.landing_body", lang))}</p>
      <p class="mb-0"><a href="/">{esc(translate("auth.updated_link", lang))}</a></p>
    </div>
  </div>
</body>
</html>""".encode("utf-8")


def egress_chip(conn: Any, sharing_count: int, lang: str) -> str:
    """Marca de saída de rede da conexão, em modo somente leitura.

    O risco de bloqueio não vem de várias sessões na mesma conta -- isso os
    provedores aceitam -- e sim de várias contas saindo pelo mesmo endereço.
    Por isso "compartilhada" só vira aviso a partir da segunda conta nessa
    situação: sozinha, ela é a única dona daquele IP.
    """
    estado = conn.egress_status
    if estado == "bound":
        pool = conn.egress_binding or "?"
        return (
            '<span class="badge bg-success-subtle text-success-emphasis">'
            f'<i class="bi bi-shield-check me-1" aria-hidden="true"></i>'
            f'{esc(translate("egress.bound", lang))}: {esc(pool)}</span>'
        )
    if estado == "shared":
        if sharing_count > 1:
            return (
                '<span class="badge bg-warning-subtle text-warning-emphasis">'
                f'<i class="bi bi-diagram-3 me-1" aria-hidden="true"></i>'
                f'{esc(translate("egress.shared", lang, count=sharing_count))}</span>'
            )
        return (
            '<span class="text-secondary">'
            f'<i class="bi bi-diagram-3 me-1" aria-hidden="true"></i>'
            f'{esc(translate("egress.single", lang))}</span>'
        )
    return (
        '<span class="text-secondary">'
        f'<i class="bi bi-question-circle me-1" aria-hidden="true"></i>'
        f'{esc(translate("egress.unknown", lang))}</span>'
    )


def render_login_page(
    lang: str = DEFAULT_LANGUAGE,
    erro: str = "",
    desafio: str = "",
    dificuldade: int = 4,
    sso_nome: str = "",
) -> bytes:
    """Formulario de entrada, com a mesma casca e a mesma paleta do painel.

    Existe porque o dialogo do Basic Auth e uma janela do NAVEGADOR: nao se
    traduz, nao se estiliza, nao oferece logout e nao e HTML -- qualquer
    ferramenta que dirija um navegador para no dialogo, porque nao ha nada na
    pagina para preencher. Esta pagina resolve os quatro de uma vez.
    """
    lang = normalize_language(lang)
    aviso = (
        f'<div class="alert alert-danger d-flex align-items-center gap-2 mb-3" role="alert">'
        f'<i class="bi bi-exclamation-octagon-fill" aria-hidden="true"></i>'
        f'<span>{esc(erro)}</span></div>'
        if erro
        else ""
    )
    desafio_html = (
        f'<input type="hidden" name="desafio" value="{esc(desafio)}">'
        f'<input type="hidden" name="resposta" id="resposta" value="">'
        f'<p class="text-secondary small d-flex align-items-center gap-2" id="aviso-desafio">'
        f'<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>'
        f'{esc(translate("auth.challenge", lang))}</p>'
        f'<script>'
        f'(async () => {{'
        f'  const desafio = {desafio!r};'
        f'  const alvo = "0".repeat({dificuldade});'
        f'  const cod = new TextEncoder();'
        f'  for (let n = 0; n < 20000000; n++) {{'
        f'    const buf = await crypto.subtle.digest("SHA-256", cod.encode(desafio + n));'
        f'    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");'
        f'    if (hex.startsWith(alvo)) {{'
        f'      document.getElementById("resposta").value = String(n);'
        f'      document.getElementById("aviso-desafio").remove();'
        f'      break;'
        f'    }}'
        f'  }}'
        f'}})();'
        f'</script>'
        if desafio
        else ""
    )
    # O botao do SSO e um LINK, nunca um `<form>`: a CSP do painel declara
    # `form-action 'self'` e o navegador bloqueia, sem erro visivel na tela, a
    # submissao que redireciona para fora. Ele fica AO LADO do formulario local,
    # que nao sai da tela em configuracao nenhuma -- se o provedor de identidade
    # cair, ninguem entraria.
    botao_sso = (
        f'<div class="d-flex align-items-center gap-2 my-3 text-secondary small">'
        f'<hr class="flex-grow-1 my-0"><span>{esc(translate("sso.or", lang))}</span>'
        f'<hr class="flex-grow-1 my-0"></div>'
        f'<a class="btn btn-outline-light w-100 d-inline-flex align-items-center '
        f'justify-content-center gap-2" href="/sso/oidc/iniciar" rel="nofollow">'
        f'<i class="bi bi-shield-check" aria-hidden="true"></i>'
        f'{esc(translate("sso.sign_in_with", lang, provider=sso_nome))}</a>'
        if sso_nome
        else ""
    )
    return f"""<!DOCTYPE html>
<html lang="{esc(lang)}" data-bs-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="{FAVICON}">
  <title>9RTKSync</title>
  <link rel="stylesheet" href="{BOOTSTRAP_CSS}">
  <link rel="stylesheet" href="{BOOTSTRAP_ICONS}">
  <style>
    :root {{ --bg: #091413; --surface: #102422; --line: #1e413d;
             --accent: #2fb8a4; --text: #e6e8ee; }}
    body {{ background: var(--bg); color: var(--text); font-family: {FONT_STACK}; }}
    .card {{ background: var(--surface); border: 1px solid var(--line); }}
    .btn-primary {{ --bs-btn-bg: var(--accent); --bs-btn-border-color: var(--accent);
                    --bs-btn-color: var(--bg); --bs-btn-hover-bg: var(--accent);
                    --bs-btn-hover-border-color: var(--accent); --bs-btn-hover-color: var(--bg); }}
    .form-control {{ background: var(--bg); border-color: var(--line); color: var(--text); }}
    .form-control:focus {{ background: var(--bg); color: var(--text);
                           border-color: var(--accent); box-shadow: none; }}
  </style>
</head>
<body class="d-flex align-items-center justify-content-center" style="min-height:100vh">
  <main class="card" style="max-width:24rem;width:100%">
    <div class="card-body p-4">
      <h1 class="h5 mb-1 d-flex align-items-center gap-2">
        <i class="bi bi-shield-lock" aria-hidden="true"></i>9RTKSync
      </h1>
      <p class="text-secondary small mb-4">{esc(translate("auth.login_intro", lang))}</p>
      {aviso}
      <form method="post" action="/login">
        <div class="mb-3">
          <label class="form-label small" for="usuario">{esc(translate("auth.user", lang))}</label>
          <input class="form-control" id="usuario" name="usuario" autocomplete="username" autofocus required>
        </div>
        <div class="mb-4">
          <label class="form-label small" for="senha">{esc(translate("auth.password", lang))}</label>
          <input class="form-control" id="senha" name="senha" type="password"
                 autocomplete="current-password" required>
        </div>
        {desafio_html}
        <button class="btn btn-primary w-100" type="submit">
          <i class="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i>{esc(translate("auth.enter", lang))}
        </button>
      </form>
      {botao_sso}
    </div>
  </main>
</body>
</html>""".encode("utf-8")


def health_badge(status: str, lang: str) -> str:
    """Monta o badge de saúde com ícone de fonte."""
    css, icon = HEALTH_PRESENTATION.get(status, HEALTH_PRESENTATION["unknown"])
    label = translate(f"health.{status}", lang)
    return (
        f'<span class="badge {css} d-inline-flex align-items-center gap-1">'
        f'<i class="bi {icon}" aria-hidden="true"></i>{esc(label)}</span>'
    )


def render_language_switcher(current: str) -> str:
    """Seletor de idioma com bandeiras reais (flag-icons), não emoji."""
    current = normalize_language(current)
    _, current_flag = LANGUAGES[current]
    items = []
    for code, (label, flag) in LANGUAGES.items():
        active = " active" if code == current else ""
        items.append(
            f'<li><button class="dropdown-item d-flex align-items-center gap-2{active}" '
            f'type="submit" name="lang" value="{esc(code)}">'
            f'<span class="fi {esc(flag)}"></span>{esc(label)}</button></li>'
        )
    return f"""
        <form method="post" action="/acoes/idioma" class="m-0 dropdown">
          <button class="btn btn-outline-light btn-sm dropdown-toggle d-inline-flex align-items-center gap-2"
                  type="button" data-bs-toggle="dropdown" aria-expanded="false"
                  aria-label="{esc(translate('language.label', current))}">
            <span class="fi {esc(current_flag)}"></span>
          </button>
          <ul class="dropdown-menu dropdown-menu-end">{"".join(items)}
          </ul>
        </form>"""


def metric_card(label: str, value: Any, icon: str, tone: str) -> str:
    return f"""
      <div class="col-6 col-lg-3">
        <div class="card metric h-100">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2 metric-label">
              <i class="bi {icon} {tone}" aria-hidden="true"></i><span>{esc(label)}</span>
            </div>
            <div class="metric-value {tone}">{esc(value)}</div>
          </div>
        </div>
      </div>"""


def render_security_banner(is_default_password: bool, lang: str) -> str:
    if not is_default_password:
        return ""
    return f"""
      <div class="alert alert-warning d-flex align-items-center justify-content-between gap-3" role="alert">
        <div class="d-flex align-items-start gap-2">
          <i class="bi bi-shield-exclamation fs-5" aria-hidden="true"></i>
          <div><strong>{esc(translate("security.title", lang))}</strong>
            {translate("security.body", lang)}</div>
        </div>
        <button class="btn btn-warning btn-sm text-nowrap" data-bs-toggle="modal" data-bs-target="#modalCredenciais">
          <i class="bi bi-key-fill me-1" aria-hidden="true"></i>{esc(translate("action.change_credentials", lang))}
        </button>
      </div>"""



def _campo_de_texto(nome: str, rotulo: str, valor: str, ajuda: str = "",
                    placeholder: str = "", desabilitado: bool = False) -> str:
    """Um campo de texto do formulario de SSO, com rotulo e ajuda traduzidos."""
    trava = " disabled" if desabilitado else ""
    dica = f'<div class="form-text">{esc(ajuda)}</div>' if ajuda else ""
    return f"""
              <div class="mb-3">
                <label class="form-label small" for="sso_{esc(nome)}">{esc(rotulo)}</label>
                <input class="form-control form-control-sm" id="sso_{esc(nome)}" name="{esc(nome)}"
                       value="{esc(valor)}" placeholder="{esc(placeholder)}"
                       autocomplete="off" spellcheck="false"{trava}>
                {dica}
              </div>"""


def render_sso_modal(sso_view: Optional[Dict[str, Any]], lang: str) -> str:
    """Tela de configuracao do SSO: duas abas, e nenhum segredo de volta.

    O segredo do cliente NUNCA e reexibido. A tela diz apenas que existe um valor
    guardado e oferece um campo para substitui-lo; salvar com o campo em branco
    mantem o que ja esta la.
    """
    dados = dict(sso_view or {})
    config = dict(dados.get("config") or {})
    tem_segredo = bool(dados.get("tem_segredo"))
    do_ambiente = bool(dados.get("segredo_do_ambiente"))
    desligado = bool(dados.get("desligado_por_ambiente"))
    saml_ok = bool(dados.get("saml_disponivel"))
    ligado = config.get("enabled", "") == "oidc"

    aviso_ambiente = (
        f"""
          <div class="alert alert-warning d-flex align-items-start gap-2" role="note">
            <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
            <div>{esc(translate("sso.disabled_by_env", lang))}</div>
          </div>"""
        if desligado
        else ""
    )

    estado_do_segredo = (
        translate("sso.secret_from_env", lang)
        if do_ambiente
        else (
            translate("sso.secret_stored", lang)
            if tem_segredo
            else translate("sso.secret_missing", lang)
        )
    )

    callback = dados.get("callback_url") or ""
    bloco_callback = (
        f"""
              <div class="mb-3">
                <label class="form-label small">{esc(translate("sso.callback_url", lang))}</label>
                <div class="form-control form-control-sm font-monospace text-truncate"
                     title="{esc(callback)}">{esc(callback)}</div>
                <div class="form-text">{esc(translate("sso.callback_help", lang))}</div>
              </div>"""
        if callback
        else ""
    )

    aba_oidc = f"""
              <div class="mb-3">
                <label class="form-label small" for="sso_enabled">{esc(translate("sso.enabled_label", lang))}</label>
                <select class="form-select form-select-sm" id="sso_enabled" name="enabled">
                  <option value=""{"" if ligado else " selected"}>{esc(translate("sso.enabled_off", lang))}</option>
                  <option value="oidc"{" selected" if ligado else ""}>{esc(translate("sso.enabled_oidc", lang))}</option>
                </select>
                <div class="form-text">{esc(translate("sso.enabled_help", lang))}</div>
              </div>
              {_campo_de_texto("base_url", translate("sso.base_url", lang),
                               config.get("base_url", ""), translate("sso.base_url_help", lang),
                               "https://painel.exemplo.com")}
              {bloco_callback}
              {_campo_de_texto("issuer", translate("sso.issuer", lang),
                               config.get("issuer", ""), translate("sso.issuer_help", lang),
                               "https://accounts.google.com")}
              {_campo_de_texto("client_id", translate("sso.client_id", lang),
                               config.get("client_id", ""))}
              <div class="mb-3">
                <label class="form-label small" for="sso_client_secret">{esc(translate("sso.client_secret", lang))}</label>
                <input class="form-control form-control-sm" id="sso_client_secret" name="client_secret"
                       type="password" autocomplete="new-password"
                       placeholder="{esc("••••••••" if tem_segredo else "")}"
                       {"disabled" if do_ambiente else ""}>
                <div class="form-text">{esc(estado_do_segredo)} {esc(translate("sso.secret_keep_help", lang))}</div>
              </div>
              {_campo_de_texto("scopes", translate("sso.scopes", lang),
                               config.get("scopes", ""), translate("sso.scopes_help", lang))}
              {_campo_de_texto("allowed_domains", translate("sso.allowed_domains", lang),
                               config.get("allowed_domains", ""),
                               translate("sso.allowlist_help", lang), "empresa.com,filial.com")}
              {_campo_de_texto("allowed_emails", translate("sso.allowed_emails", lang),
                               config.get("allowed_emails", ""), "", "chefe@empresa.com")}"""

    aviso_saml = (
        translate("sso.saml_pending", lang) if saml_ok else translate("sso.saml_unavailable", lang)
    )
    aba_saml = f"""
              <div class="alert alert-secondary d-flex align-items-start gap-2" role="note">
                <i class="bi bi-info-circle-fill" aria-hidden="true"></i>
                <div>{esc(aviso_saml)}</div>
              </div>
              {_campo_de_texto("saml_idp_entity_id", translate("sso.idp_entity_id", lang),
                               "", "", "", desabilitado=True)}
              {_campo_de_texto("saml_idp_sso_url", translate("sso.idp_sso_url", lang),
                               "", "", "", desabilitado=True)}
              {_campo_de_texto("saml_idp_cert", translate("sso.idp_cert", lang),
                               "", translate("sso.idp_cert_help", lang), "", desabilitado=True)}"""

    return f"""
  <div class="modal fade" id="modalSSO" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title h6 d-inline-flex align-items-center gap-2">
            <i class="bi bi-person-badge" aria-hidden="true"></i>{esc(translate("sso.title", lang))}
          </h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal"
                  aria-label="{esc(translate("action.close", lang))}"></button>
        </div>
        <div class="modal-body">
          {aviso_ambiente}
          <p class="text-secondary small">{esc(translate("sso.intro", lang))}</p>
          <div class="alert alert-secondary d-flex align-items-start gap-2" role="note">
            <i class="bi bi-hdd-network" aria-hidden="true"></i>
            <div>{esc(translate("sso.tunnel_warning", lang))}</div>
          </div>
          <form method="post" action="/acoes/sso">
            <ul class="nav nav-tabs mb-3" role="tablist">
              <li class="nav-item" role="presentation">
                <button class="nav-link active" type="button" role="tab"
                        data-bs-toggle="tab" data-bs-target="#abaOIDC"
                        aria-controls="abaOIDC" aria-selected="true">{esc(translate("sso.tab_oidc", lang))}</button>
              </li>
              <li class="nav-item" role="presentation">
                <button class="nav-link" type="button" role="tab"
                        data-bs-toggle="tab" data-bs-target="#abaSAML"
                        aria-controls="abaSAML" aria-selected="false">{esc(translate("sso.tab_saml", lang))}</button>
              </li>
            </ul>
            <div class="tab-content">
              <div class="tab-pane fade show active" id="abaOIDC" role="tabpanel">{aba_oidc}
              </div>
              <div class="tab-pane fade" id="abaSAML" role="tabpanel">{aba_saml}
              </div>
            </div>
            <hr>
            <div class="mb-3">
              <label class="form-label small" for="sso_senha_atual">{esc(translate("sso.current_password", lang))}</label>
              <input class="form-control form-control-sm" id="sso_senha_atual" name="senha_atual"
                     type="password" autocomplete="current-password" required>
              <div class="form-text">{esc(translate("sso.current_password_help", lang))}</div>
            </div>
            <button class="btn btn-primary w-100" type="submit">
              <i class="bi bi-save me-1" aria-hidden="true"></i>{esc(translate("sso.save", lang))}
            </button>
          </form>
        </div>
      </div>
    </div>
  </div>"""


def cabecalho_de_dominio(rows: List[str], lang: str) -> str:
    """A casca das tabelas de dominio: SEMPRE as mesmas sete colunas.

    Conexoes, chaves virtuais e modelos sao coisas diferentes lidas do mesmo
    jeito -- quem serve, como se chama, de que tipo e, como esta, quanto tempo
    resta, quando foi renovado, e o (i) que abre o resto. Uma casca so mantem a
    largura das colunas identica entre os cartoes e entre os tres paineis.
    """
    return f"""
        <div class="table-responsive">
          <table class="table table-dark table-hover align-middle mb-0 tabela-dominio">
            <colgroup>
              <col class="c-provedor"><col class="c-nome"><col class="c-tipo">
              <col class="c-status"><col class="c-validade"><col class="c-renovacao">
              <col class="c-detalhe">
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{esc(translate("table.provider", lang))}</th>
                <th scope="col">{esc(translate("table.name", lang))}</th>
                <th scope="col">{esc(translate("table.type", lang))}</th>
                <th scope="col">{esc(translate("table.status", lang))}</th>
                <th scope="col">{esc(translate("table.remaining", lang))}</th>
                <th scope="col">{esc(translate("table.last_refresh", lang))}</th>
                <th scope="col" class="text-end">{esc(translate("table.details", lang))}</th>
              </tr>
            </thead>
            <tbody>{"".join(rows)}
            </tbody>
          </table>
        </div>"""


def estado_vazio(mensagem: str) -> str:
    """O bloco de estado vazio da familia: icone bi-inbox e uma frase.

    Os quatro cartoes de tabela usam exatamente este bloco. Cada um deles existe
    nos tres paineis por contrato; quando o gateway deste produto nao tem aquele
    conceito, ou ainda nao tem dado nenhum, o cartao continua na tela e a frase
    diz por que esta vazio AQUI. Assimetria de cartoes e pior que estado vazio.
    """
    return f"""
        <div class="text-center text-secondary py-5">
          <i class="bi bi-inbox fs-1 d-block mb-2" aria-hidden="true"></i>
          {esc(mensagem)}
        </div>"""


def detail_button(modal_id: str, lang: str) -> str:
    """Botao (i) da linha, que abre o modal de detalhe daquele item."""
    return f"""<button class="btn btn-outline-light btn-sm py-0 px-2" type="button"
                        data-bs-toggle="modal" data-bs-target="#{esc(modal_id)}"
                        title="{esc(translate("table.details", lang))}">
                  <i class="bi bi-info-circle" aria-hidden="true"></i>
                </button>"""


def render_detail_modal(modal_id: str, titulo: str, linhas: List[tuple], lang: str,
                        extra: str = "") -> str:
    """Modal de detalhe no formato que a familia usa: titulo, pares e um extra.

    O modal e devolvido como bloco solto para ser emitido DEPOIS da tabela: um
    `<div>` dentro de `<tbody>` e HTML invalido, e o navegador o move sozinho
    para fora -- o que transforma cada linha da tabela numa surpresa de layout.
    """
    corpo = "".join(
        f'<dt class="col-5 text-secondary fw-normal">{esc(rotulo)}</dt>'
        f'<dd class="col-7 text-end">{valor}</dd>'
        for rotulo, valor in linhas
    )
    return f"""
  <div class="modal fade" id="{esc(modal_id)}" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title h6 d-inline-flex align-items-center gap-2">
            <i class="bi bi-info-circle" aria-hidden="true"></i>{esc(titulo)}
          </h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal"
                  aria-label="{esc(translate("action.close", lang))}"></button>
        </div>
        <div class="modal-body">
          <dl class="row mb-0 small">{corpo}</dl>
          {extra}
        </div>
      </div>
    </div>
  </div>"""


def render_remaining_seconds(remaining: Optional[int], lang: str) -> str:
    """Validade restante de um item que nao e conexao (chave virtual, modelo).

    Sem prazo declarado a chave e estatica: vale ate ser desativada, e isso e
    "sem expiracao" de verdade -- nao o dado ausente que render_remaining trata
    com cautela no caso do OAuth.
    """
    if remaining is not None:
        return esc(format_duration(remaining, lang))
    return f'<span class="text-secondary">{esc(translate("duration.no_expiry_short", lang))}</span>'


def render_timestamp_cell(carimbo: Optional[str], lang: str, icone: str) -> str:
    """Celula de carimbo de tempo curto, com o valor inteiro guardado no modal."""
    if not carimbo:
        return f'<span class="text-secondary">{esc(translate("table.never_refreshed", lang))}</span>'
    return (f'<i class="bi {icone} me-1 text-secondary" aria-hidden="true"></i>'
            f'<span class="font-monospace">{esc(format_timestamp_curto(carimbo))}</span>')


def key_state_label(key: Any, lang: str) -> str:
    """Se o gateway ainda aceita esta chave.

    O ``apiKeys`` do 9Router tem uma bandeira so, ``isActive``: nao existe aqui
    a distincao entre revogada e banida que o irmao OminiRTkSync mostra, e
    inventar os rotulos faria a tela prometer um dado que o banco nao guarda.
    """
    if key.revoked:
        return translate("keys.disabled", lang)
    return translate("keys.enabled", lang)


def render_key_details(key: Any, modal_id: str, lang: str) -> str:
    """Modal com o que nao cabe na linha da chave virtual.

    O instante exato de emissao, a maquina a que a chave esta amarrada e o modo
    de acesso sao diagnostico: espremidos na tabela empurrariam as colunas uteis
    para fora da tela. O TOKEN nunca entra aqui -- ele sequer e lido do banco.
    """
    nao_declarado = f'<span class="text-secondary">{esc(translate("table.not_declared", lang))}</span>'
    linhas = [
        (translate("table.status", lang), health_badge(key.health_status, lang)),
        (translate("table.key_state", lang), esc(key_state_label(key, lang))),
        (translate("table.remaining", lang), render_remaining_seconds(key.remaining_seconds, lang)),
        (translate("table.issued_at", lang),
         f'<span class="font-monospace">{esc(format_timestamp(key.issued_at))}</span>'),
        # O 9Router nao guarda restricao de modelo por chave: toda chave que ele
        # emite alcanca o catalogo inteiro, e dizer isso e mais util do que
        # omitir a linha e deixar a pergunta em aberto.
        (translate("table.model_access", lang), esc(translate("keys.access_all", lang))),
        (translate("table.source", lang),
         f'<span class="font-monospace">{esc(key.machine_id)}</span>' if key.machine_id
         else nao_declarado),
    ]
    return render_detail_modal(modal_id, key.name, linhas, lang)


def render_keys_table(keys: List[Any], lang: str) -> str:
    """Chaves virtuais emitidas pelo gateway, uma por linha, nas sete colunas."""
    if not keys:
        return estado_vazio(translate("keys.empty", lang))

    rows = []
    detalhes = []
    # Id do modal pelo INDICE, nunca pelo nome: nome de chave aceita espaco,
    # acento e barra, e nada disso vale como id de elemento HTML.
    for indice, key in enumerate(keys):
        modal_id = f"detalhe-chave-{indice}"
        rows.append(f"""
            <tr>
              <td><span class="provider-chip">{esc(PROVEDOR_DO_GATEWAY)}</span></td>
              <td class="fw-semibold">{esc(key.name)}</td>
              <td class="text-nowrap">
                <i class="bi bi-key me-1 text-secondary" aria-hidden="true"></i>{esc(translate("type.virtual_key", lang))}
              </td>
              <td>{health_badge(key.health_status, lang)}</td>
              <td class="text-nowrap">{render_remaining_seconds(key.remaining_seconds, lang)}</td>
              <td class="text-nowrap small">{render_timestamp_cell(key.issued_at, lang, "bi-clock")}</td>
              <td class="text-end">{detail_button(modal_id, lang)}</td>
            </tr>""")
        detalhes.append(render_key_details(key, modal_id, lang))

    return cabecalho_de_dominio(rows, lang) + "".join(detalhes)


def render_model_details(model: Any, modal_id: str, lang: str) -> str:
    """Modal com o que nao cabe na linha do modelo.

    O nome da conexao dona esta aqui porque e ele que explica de onde vem o
    status da linha -- um modelo nao tem saude propria.
    """
    nao_declarado = f'<span class="text-secondary">{esc(translate("table.not_declared", lang))}</span>'
    linhas = [
        (translate("table.provider", lang),
         f'<span class="provider-chip">{esc(model.provider)}</span>' if model.provider
         else nao_declarado),
        (translate("table.connection", lang),
         esc(model.connection_name) if model.connection_name else nao_declarado),
        (translate("table.status", lang), health_badge(model.health_status, lang)),
        (translate("table.remaining", lang), render_remaining_seconds(model.remaining_seconds, lang)),
        (translate("table.source", lang),
         f'<span class="font-monospace">{esc(model.source)}</span>' if model.source
         else nao_declarado),
    ]
    extra = f'<p class="text-secondary small mb-0 mt-3">{esc(translate("models.inherited", lang))}</p>'
    return render_detail_modal(modal_id, model.id, linhas, lang, extra)


def render_models_table(models: List[Any], lang: str, estado: str = "ok") -> str:
    """Modelos que o gateway publica, nas mesmas sete colunas dos irmaos.

    `estado` carrega POR QUE a lista veio vazia. Sem isso, "nenhum modelo" e
    "nao deu para perguntar" desenham a mesma tela, e o operador vai procurar um
    cadastro faltando quando o problema era o gateway nao ter respondido.
    """
    if not models:
        motivo = {
            "no_key": "models.no_key",
            "unreachable": "models.unreachable",
        }.get(estado, "models.empty")
        return estado_vazio(translate(motivo, lang))

    visiveis = models[:MAX_LINHAS_DE_MODELO]
    rows = []
    detalhes = []
    for indice, model in enumerate(visiveis):
        modal_id = f"detalhe-modelo-{indice}"
        provedor = (f'<span class="provider-chip">{esc(model.provider)}</span>'
                    if model.provider else '<span class="text-secondary">—</span>')
        rows.append(f"""
            <tr>
              <td>{provedor}</td>
              <td class="fw-semibold font-monospace">{esc(model.id)}</td>
              <td class="text-nowrap">
                <i class="bi bi-cpu me-1 text-secondary" aria-hidden="true"></i>{esc(translate("type.synced_model", lang))}
              </td>
              <td>{health_badge(model.health_status, lang)}</td>
              <td class="text-nowrap">{render_remaining_seconds(model.remaining_seconds, lang)}</td>
              <td class="text-nowrap small">{render_timestamp_cell(model.last_refresh_at, lang, "bi-arrow-repeat")}</td>
              <td class="text-end">{detail_button(modal_id, lang)}</td>
            </tr>""")
        detalhes.append(render_model_details(model, modal_id, lang))

    # Truncar em silencio seria mentir sobre o tamanho do catalogo.
    rodape = ""
    if len(models) > len(visiveis):
        rodape = (f'<p class="text-secondary small mb-0 px-3 py-2">'
                  f'{esc(translate("models.showing", lang, shown=len(visiveis), total=len(models)))}</p>')

    return cabecalho_de_dominio(rows, lang) + rodape + "".join(detalhes)


def render_connection_details(conn: Any, refresh_margin: int, sharing_count: int, lang: str) -> str:
    """Modal com o que nao cabe na linha da tabela.

    A tabela existe para varrer muitas conexoes de relance; o diagnostico e uma
    frase inteira, e espremido entre sete colunas ele sobrepunha a coluna
    vizinha. Aqui ele aparece por extenso, junto do resto do estado daquela
    conexao, sem competir com nada.
    """
    linhas = [
        (translate("table.provider", lang), f'<span class="provider-chip">{esc(conn.provider)}</span>'),
        (translate("table.status", lang), health_badge(conn.health_status, lang)),
        (translate("table.remaining", lang), render_remaining(conn, lang)),
        (translate("table.last_refresh", lang), render_last_refresh(conn, lang)),
    ]
    if conn.is_local and conn.base_url:
        linhas.append((translate("table.type", lang),
                       f'<span class="font-monospace">{esc(conn.base_url)}</span>'))
    if not conn.is_local:
        chip = egress_chip(conn, sharing_count, lang)
        if chip:
            linhas.append((translate("egress.title", lang), chip))

    modelos = ""
    if conn.is_local and conn.local_models:
        itens = "".join(f'<li class="font-monospace small">{esc(m)}</li>' for m in conn.local_models)
        modelos = (f'<p class="text-secondary small mb-1 mt-3">{esc(translate("table.models", lang))}</p>'
                   f'<ul class="mb-0">{itens}</ul>')

    extra = (
        f'<p class="text-secondary small mb-1 mt-3">{esc(translate("table.diagnosis", lang))}</p>'
        f'<p class="mb-0">{esc(render_refresh_reason(conn, refresh_margin, lang))}</p>'
        f'{modelos}'
    )
    return render_detail_modal(f"detalhe-{conn.id}", conn.name, linhas, lang, extra)


def render_connections_table(connections: List[Any], refresh_margin: int, lang: str) -> str:
    if not connections:
        return estado_vazio(translate("connections.empty", lang))

    # Quantas contas de nuvem saem pelo endereço padrão do gateway. Uma conta
    # sozinha compartilhando não é problema nenhum -- ela é a única a usar
    # aquele IP. O alerta só faz sentido a partir da segunda, que é quando o
    # provedor passa a ver identidades distintas na mesma origem.
    compartilhando = sum(
        1 for c in connections if not c.is_local and c.egress_status == "shared"
    )

    rows = []
    detalhes = []
    for c in connections:
        if c.is_local:
            kind, kind_icon = translate("type.local", lang), "bi-hdd-network"
        elif c.is_oauth:
            kind, kind_icon = translate("type.oauth", lang), "bi-person-badge"
        elif c.has_api_key:
            kind, kind_icon = translate("type.api_key", lang), "bi-key"
        else:
            kind, kind_icon = translate("type.local", lang), "bi-hdd-network"

        # Instancia local: mostra a origem e os modelos que ela realmente serve.
        detail = ""
        if c.is_local:
            models = c.local_models
            parts = []
            if c.base_url:
                parts.append(f'<span class="font-monospace">{esc(c.base_url)}</span>')
            if models:
                preview = ", ".join(models[:3]) + (f" (+{len(models) - 3})" if len(models) > 3 else "")
                parts.append(
                    f'<span class="badge text-bg-dark">{len(models)} '
                    f'{esc(translate("table.models", lang))}</span> {esc(preview)}'
                )
            if parts:
                detail = f'<div class="small text-secondary mt-1">{" · ".join(parts)}</div>'
        else:
            # Saída de rede: somente leitura. Quem roteia a requisição é o
            # gateway; o painel existe para que o operador veja quais contas
            # dividem endereço antes que o provedor veja primeiro.
            chip = egress_chip(c, compartilhando, lang)
            if chip:
                detail = f'<div class="small mt-1">{chip}</div>'

        rows.append(f"""
            <tr>
              <td><span class="provider-chip">{esc(c.provider)}</span></td>
              <td class="fw-semibold">{esc(c.name)}{detail}</td>
              <td class="text-nowrap">
                <i class="bi {kind_icon} me-1 text-secondary" aria-hidden="true"></i>{esc(kind)}
              </td>
              <td>{health_badge(c.health_status, lang)}</td>
              <td class="text-nowrap">{render_remaining(c, lang, curto=True)}</td>
              <td class="text-nowrap small">{render_last_refresh(c, lang)}</td>
              <td class="text-end">{detail_button(f"detalhe-{c.id}", lang)}</td>
            </tr>""")
        detalhes.append(render_connection_details(c, refresh_margin, compartilhando, lang))

    return cabecalho_de_dominio(rows, lang) + "".join(detalhes)


def render_combos_table(combos: List[Dict[str, Any]], lang: str) -> str:
    if not combos:
        return estado_vazio(translate("combos.empty", lang))

    rows = []
    for combo in combos:
        models = combo.get("models") or []
        if isinstance(models, str):
            models = [models]
        preview = ", ".join(str(m) for m in models[:4])
        if len(models) > 4:
            preview += f" (+{len(models) - 4})"
        rows.append(f"""
            <tr>
              <td class="fw-semibold">{esc(combo.get("name", "—"))}</td>
              <td class="small text-secondary">{esc(preview) or "—"}</td>
            </tr>""")

    return f"""
        <div class="table-responsive">
          <table class="table table-dark table-hover align-middle mb-0">
            <thead>
              <tr>
                <th scope="col">{esc(translate("table.combo", lang))}</th>
                <th scope="col">{esc(translate("table.cascade", lang))}</th>
              </tr>
            </thead>
            <tbody>{"".join(rows)}
            </tbody>
          </table>
        </div>"""


def render_cron_history(history: List[Dict[str, Any]], lang: str) -> str:
    """Lista de execuções do cron, cada uma com o log do que realmente aconteceu."""
    if not history:
        return f'<p class="text-secondary small mb-0">{esc(translate("cron.no_runs", lang))}</p>'

    items = []
    for index, entry in enumerate(history):
        failed = not entry.get("success", True) or entry.get("error")
        tone = "danger" if failed else "secondary"
        icon = "bi-exclamation-octagon-fill" if failed else "bi-check-circle"
        log_lines = entry.get("log") or []
        if entry.get("error") and not any(str(entry["error"]) in line for line in log_lines):
            log_lines = [f"ERRO: {entry['error']}", *log_lines]

        body = (
            "<pre class=\"cron-log mb-0\">" + esc("\n".join(log_lines)) + "</pre>"
            if log_lines
            else f'<p class="text-secondary small mb-0">{esc(translate("cron.no_runs", lang))}</p>'
        )

        items.append(f"""
          <div class="accordion-item">
            <h3 class="accordion-header">
              <button class="accordion-button collapsed py-2" type="button"
                      data-bs-toggle="collapse" data-bs-target="#ciclo{index}"
                      aria-expanded="false" aria-controls="ciclo{index}">
                <span class="d-flex align-items-center gap-2 w-100 pe-3">
                  <i class="bi {icon} text-{tone}" aria-hidden="true"></i>
                  <span class="font-monospace small">{esc(format_timestamp(entry.get("timestamp")))}</span>
                  <span class="ms-auto small text-secondary">
                    {esc(translate("cron.result_line", lang,
                                   inspected=entry.get("totalInspected", 0),
                                   refreshed=entry.get("refreshedCount", 0),
                                   duration=entry.get("durationMs", 0)))}
                  </span>
                </span>
              </button>
            </h3>
            <div id="ciclo{index}" class="accordion-collapse collapse">
              <div class="accordion-body py-2">{body}</div>
            </div>
          </div>""")

    return f'<div class="accordion accordion-flush" id="historicoCron">{"".join(items)}</div>'


def render_cron_card(cron: Dict[str, Any], lang: str) -> str:
    active = bool(cron.get("active"))
    state_icon = "bi-broadcast text-success" if active else "bi-pause-circle text-secondary"
    state_text = (
        translate("cron.active", lang, interval=cron.get("intervalSeconds", "—"))
        if active
        else translate("cron.disabled", lang)
    )
    last = cron.get("lastResult") or {}
    failed = bool(last) and (not last.get("success", True) or last.get("error"))

    return f"""
      <div class="card h-100">
        <div class="card-header d-flex align-items-center justify-content-between">
          <span class="d-inline-flex align-items-center gap-2">
            <i class="bi bi-alarm" aria-hidden="true"></i>{esc(translate("cron.title", lang))}
          </span>
          <div class="d-flex gap-2">
            <button class="btn btn-outline-light btn-sm" type="button"
                    data-bs-toggle="modal" data-bs-target="#modalHistorico">
              <i class="bi bi-list-columns-reverse me-1" aria-hidden="true"></i>Logs
              {'<span class="badge text-bg-danger ms-1">!</span>' if failed else ""}
            </button>
            <form method="post" action="/acoes/cron" class="m-0">
              <button class="btn btn-outline-light btn-sm" type="submit">
                <i class="bi bi-play-fill me-1" aria-hidden="true"></i>{esc(translate("cron.run_now", lang))}
              </button>
            </form>
          </div>
        </div>
        <div class="card-body">
          <p class="d-flex align-items-center gap-2 mb-3">
            <i class="bi {state_icon}" aria-hidden="true"></i><span>{esc(state_text)}</span>
          </p>
          <dl class="row mb-0 small">
            <dt class="col-4 text-secondary fw-normal">{esc(translate("cron.next_run", lang))}</dt>
            <dd class="col-8 text-end font-monospace text-nowrap">{esc(format_timestamp(cron.get("nextRunAt")))}</dd>
            <dt class="col-4 text-secondary fw-normal">{esc(translate("cron.total_renewals", lang))}</dt>
            <dd class="col-8 text-end font-monospace">{esc(cron.get("totalRenewals", 0))}</dd>
            <dt class="col-4 text-secondary fw-normal mt-2">{esc(translate("cron.last_result", lang))}</dt>
            <dd class="col-8 text-end font-monospace small mb-0 mt-2 {'text-danger' if failed else ''}">
              {esc(translate("cron.result_line", lang,
                             inspected=last.get("totalInspected", 0),
                             refreshed=last.get("refreshedCount", 0),
                             duration=last.get("durationMs", 0))
                   if last else translate("cron.no_runs", lang))}
              {esc(last.get("error") or "")}
            </dd>
          </dl>
        </div>
      </div>"""


def render_gateway_card(gateway: Dict[str, Any], db_path: str, lang: str) -> str:
    online = bool(gateway.get("online"))
    tone = "text-success" if online else "text-danger"
    icon = "bi-plug-fill" if online else "bi-plug"
    label = (
        f'ONLINE (HTTP {esc(gateway.get("statusCode", "—"))})'
        if online
        else f'{esc(translate("gateway.offline", lang))} — '
             f'{esc(gateway.get("error") or translate("gateway.no_response", lang))}'
    )

    # Le a bandeira; o resumo textual nunca serve como booleano.
    db_ok = bool(gateway.get("dbOk"))
    if online and db_ok:
        diagnosis = translate("gateway.diag_ok", lang)
    elif online:
        diagnosis = translate("gateway.diag_db_failed", lang)
    else:
        diagnosis = translate("gateway.diag_gateway_failed", lang)

    return f"""
      <div class="card h-100">
        <div class="card-header d-flex align-items-center justify-content-between">
          <span class="d-inline-flex align-items-center gap-2">
            <i class="bi bi-hdd-network" aria-hidden="true"></i>{esc(translate("gateway.title", lang))}
          </span>
          <form method="post" action="/acoes/testar-gateway" class="m-0">
            <button class="btn btn-outline-light btn-sm" type="submit">
              <i class="bi bi-activity me-1" aria-hidden="true"></i>{esc(translate("action.test_connection", lang))}
            </button>
          </form>
        </div>
        <div class="card-body">
          <dl class="row mb-0 small">
            <dt class="col-5 text-secondary fw-normal">{esc(translate("gateway.gateway", lang))}</dt>
            <dd class="col-7 text-end font-monospace text-truncate">{esc(gateway.get("url") or "—")}</dd>
            <dt class="col-5 text-secondary fw-normal">{esc(translate("gateway.status", lang))}</dt>
            <dd class="col-7 text-end font-monospace {tone}">
              <i class="bi {icon} me-1" aria-hidden="true"></i>{label}
            </dd>
            <dt class="col-5 text-secondary fw-normal">{esc(translate("gateway.latency", lang))}</dt>
            <dd class="col-7 text-end font-monospace">{esc(gateway.get("latencyMs", "—"))} ms</dd>
            <dt class="col-5 text-secondary fw-normal">{esc(translate("gateway.database", lang))}</dt>
            <dd class="col-7 text-end font-monospace text-truncate" title="{esc(db_path)}">
              {esc(translate("gateway.db_summary", lang,
                            connections=gateway.get("dbConnections", 0),
                            combos=gateway.get("dbCombos", 0))
                   if db_ok else translate("gateway.db_missing", lang))}
            </dd>
            <dt class="col-5 text-secondary fw-normal">{esc(translate("gateway.diagnostics", lang))}</dt>
            <dd class="col-7 text-end font-monospace mb-0 {tone}">{esc(diagnosis)}</dd>
          </dl>
        </div>
      </div>"""


def render_flash(flash: Optional[Dict[str, str]]) -> str:
    if not flash:
        return ""
    tone = flash.get("tone", "info")
    icon = {
        "success": "bi-check-circle-fill",
        "danger": "bi-exclamation-octagon-fill",
        "warning": "bi-exclamation-triangle-fill",
        "info": "bi-info-circle-fill",
    }.get(tone, "bi-info-circle-fill")
    return f"""
      <div class="alert alert-{esc(tone)} d-flex align-items-center gap-2" role="status" data-aviso>
        <i class="bi {icon}" aria-hidden="true"></i>
        <div>{esc(flash.get("message", ""))}</div>
      </div>"""


def render_dashboard(
    *,
    connections: List[Any],
    combos: List[Dict[str, Any]],
    cron: Dict[str, Any],
    # Chaves virtuais e modelos entraram depois dos outros cartoes e sao
    # opcionais na assinatura: quem chama sem eles (um teste antigo, um script)
    # continua desenhando a pagina, com os dois cartoes no estado vazio.
    keys: Optional[List[Any]] = None,
    models: Optional[List[Any]] = None,
    models_state: str = "ok",
    gateway: Dict[str, Any],
    db_path: str,
    router_url: str,
    current_user: str,
    is_default_password: bool,
    refresh_margin: int,
    auth_from_env: bool = False,
    flash: Optional[Dict[str, str]] = None,
    lang: str = DEFAULT_LANGUAGE,
    # Estado do SSO para a tela de configuracao. Opcional na assinatura pelo
    # mesmo motivo de `keys` e `models`: quem chama sem ele -- um teste antigo,
    # um script -- continua desenhando a pagina, com o modal no estado vazio.
    sso_view: Optional[Dict[str, Any]] = None,
) -> str:
    """Monta a página completa do dashboard, já com todos os dados embutidos."""
    lang = normalize_language(lang)
    keys = keys or []
    models = models or []
    oauth_count = sum(1 for c in connections if c.is_oauth)
    apikey_count = sum(1 for c in connections if c.has_api_key)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    metrics = "".join([
        metric_card(translate("metric.total_connections", lang), len(connections), "bi-diagram-2", "text-info"),
        metric_card(translate("metric.oauth_accounts", lang), oauth_count, "bi-person-badge", "text-primary"),
        metric_card(translate("metric.api_keys", lang), apikey_count, "bi-key", "text-warning"),
        metric_card(translate("metric.combos", lang), len(combos), "bi-diagram-3", "text-success"),
    ])

    change_password_block = (
        f"""
          <div class="alert alert-secondary d-flex align-items-center gap-2 mb-0" role="note">
            <i class="bi bi-lock-fill" aria-hidden="true"></i>
            <div>{translate("auth.env_managed", lang)}</div>
          </div>"""
        if auth_from_env
        else f"""
          <form method="post" action="/acoes/credenciais">
            <div class="mb-3">
              <label class="form-label" for="novoUsuario">{esc(translate("auth.user", lang))}</label>
              <input class="form-control" id="novoUsuario" name="user" autocomplete="username" required>
            </div>
            <div class="mb-3">
              <label class="form-label" for="novaSenha">{esc(translate("auth.new_password", lang))}</label>
              <input type="password" class="form-control" id="novaSenha" name="password"
                     minlength="6" autocomplete="new-password" required
                     pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{{6,}}"
                     title="{esc(translate("password.policy", lang))}">
              <div class="form-text">{esc(translate("password.policy", lang))}</div>
            </div>
            <button class="btn btn-primary w-100" type="submit">
              <i class="bi bi-save me-1" aria-hidden="true"></i>{esc(translate("action.save_credentials", lang))}
            </button>
          </form>"""
    )

    return f"""<!DOCTYPE html>
<html lang="{esc(lang)}" data-bs-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="{FAVICON}">
  <title>9RTKSync</title>
  <link rel="stylesheet" href="{BOOTSTRAP_CSS}">
  <link rel="stylesheet" href="{BOOTSTRAP_ICONS}">
  <link rel="stylesheet" href="{FLAG_ICONS}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="{GOOGLE_FONTS}">
  <style>
    /* ------------------------------------------------------------------
       Identidade visual: os tres paineis da familia RTKSync tem a MESMA
       estrutura e a MESMA folha de estilo. O que muda e o valor destes
       tokens -- verde-petroleo, quase preto.
       Trocar o produto e trocar estas oito linhas, nada mais.
       ------------------------------------------------------------------ */
    :root {{
      --bg:        #091413;   /* fundo da pagina */
      --surface:   #102422;   /* cartao */
      --surface-2: #16302d;   /* cabecalho de cartao, chip */
      --line:      #1e413d;   /* borda */
      --accent:    #2fb8a4;   /* acao primaria */
      --accent-2:  #57d6c4;   /* acao secundaria, realce */
      --brand-a:   #12806f;   /* marca, inicio do gradiente */
      --brand-b:   #2fb8a4;   /* marca, fim do gradiente */
      --text:      #e6e8ee;
      --text-dim:  #9fb8b3;
    }}
    body {{ background: var(--bg); color: var(--text); }}
    .card {{ background: var(--surface); border: 1px solid var(--line); }}
    .card-header {{ background: var(--surface-2); border-bottom: 1px solid var(--line); font-weight: 600; }}
    .metric .metric-label {{ font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-dim); }}
    .metric .metric-value {{ font-size: 2rem; font-weight: 700; line-height: 1.2; margin-top: .35rem; }}
    .provider-chip {{ background: var(--surface-2); border: 1px solid var(--line); border-radius: .35rem;
                      padding: .15rem .5rem; font-family: var(--bs-font-monospace); font-size: .78rem;
                      text-transform: uppercase; }}
    .table-dark {{ --bs-table-bg: transparent; --bs-table-border-color: var(--line); }}
    /* A marca e icone BRANCO sobre um tom claro do proprio tema. O gradiente
       de duas cores fazia as tres telas parecerem a mesma marca em cores
       diferentes; com a forma do icone distinta e o fundo discreto, quem
       identifica o produto e o desenho, e a cor fica por conta do tema. */
    .brand-mark {{ width: 2.25rem; height: 2.25rem; display: grid; place-items: center; border-radius: .5rem;
                   background: color-mix(in srgb, var(--brand-b) 22%, transparent);
                   border: 1px solid color-mix(in srgb, var(--brand-b) 45%, transparent);
                   color: #fff; font-size: 1.15rem; }}
    .accordion-item, .accordion-button {{ background: var(--surface); color: var(--text); }}
    .accordion-button:not(.collapsed) {{ background: var(--surface-2); color: #fff; box-shadow: none; }}
    .cron-log {{ white-space: pre-wrap; word-break: break-word; font-size: .8rem; color: var(--text-dim);
                 background: var(--bg); border: 1px solid var(--line); border-radius: .35rem; padding: .6rem; }}
    /* O botao primario segue o acento do produto, em vez do azul fixo do
       Bootstrap: senao os tres mudam de fundo e ficam com o mesmo botao, o que
       faz a identidade parecer acidental. */
    .btn-primary {{ --bs-btn-bg: var(--accent); --bs-btn-border-color: var(--accent);
                    --bs-btn-hover-bg: var(--accent-2); --bs-btn-hover-border-color: var(--accent-2);
                    --bs-btn-active-bg: var(--accent-2); --bs-btn-active-border-color: var(--accent-2);
                    --bs-btn-color: var(--bg); --bs-btn-hover-color: var(--bg); --bs-btn-active-color: var(--bg); }}
    a {{ color: var(--accent-2); }}
    a:hover {{ color: var(--accent); }}
    /* Barra de acoes do cabecalho: todos os controles com a MESMA altura. O
       seletor de idioma carrega so a bandeira, um elemento com altura propria;
       sem texto ao lado para definir a linha, ele esticava o botao. */
    .barra-acoes {{ display: flex; align-items: stretch; gap: .5rem; }}
    .barra-acoes > * {{ display: flex; align-items: center; }}
    .barra-acoes .btn {{ height: 2rem; padding-top: 0; padding-bottom: 0;
                         display: inline-flex; align-items: center; line-height: 1; }}
    .barra-acoes .fi {{ line-height: 1; }}
    /* A tabela de conexoes tem sete colunas, e sem largura declarada o
       navegador as reparte pelo conteudo: o diagnostico -- a coluna com a frase
       mais longa -- recebia a menor fatia e quebrava em quatro linhas, enquanto
       "Tipo" e "Status", de largura fixa, sobravam espaco. Declarar a divisao
       resolve na origem, e `table-layout: fixed` faz o navegador respeita-la em
       vez de recalcular pelo conteudo. */
    .tabela-dominio {{ table-layout: fixed; }}
    .tabela-dominio th, .tabela-dominio td {{ padding: .6rem .5rem; vertical-align: top; }}
    /* Com table-layout:fixed a largura da coluna e lei, e text-nowrap
       (white-space:nowrap!important) sem overflow:hidden nao corta nem quebra:
       o excesso se desenha POR CIMA da coluna vizinha. Foi assim que a validade
       apareceu escrita sobre a data de renovacao. O corte com reticencias
       mantem a linha legivel; o texto inteiro fica no botao (i) da linha. */
    .tabela-dominio td, .tabela-dominio th {{ overflow: hidden; text-overflow: ellipsis; }}
    /* O cabecalho nao pode quebrar no meio da palavra ("Detalhe" / "s"). */
    .tabela-dominio th {{ white-space: nowrap; }}
    .tabela-dominio col.c-provedor    {{ width: 8rem; }}
    .tabela-dominio col.c-nome        {{ width: auto; }}
    .tabela-dominio col.c-tipo        {{ width: 9.5rem; }}
    .tabela-dominio col.c-status      {{ width: 9.5rem; }}
    .tabela-dominio col.c-validade    {{ width: 11rem; }}
    .tabela-dominio col.c-renovacao   {{ width: 10.5rem; }}
    .tabela-dominio col.c-detalhe     {{ width: 5.5rem; }}
    /* O nome do provedor e um identificador longo e sem espaco
       (openai-compatible-chat-ollama-local): sem isto ele estoura a coluna ou
       forca a tabela a rolar horizontalmente inteira. */
    .tabela-dominio .provider-chip {{ display: inline-block; max-width: 100%;
                                       overflow-wrap: anywhere; white-space: normal; }}
    .tabela-dominio .diagnostico {{ overflow-wrap: anywhere; }}
    /* Em tela estreita a tabela rola sozinha, em vez de espremer as colunas
       ate o texto virar uma palavra por linha. */
    @media (max-width: 1200px) {{
      .tabela-dominio {{ min-width: 68rem; }}
    }}
  </style>
</head>
<body>
  <div class="container-xl py-4">

    {render_flash(flash)}
    {render_security_banner(is_default_password, lang)}

    <header class="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4">
      <div class="d-flex align-items-center gap-3">
        <span class="brand-mark"><i class="bi bi-lightning-charge-fill" aria-hidden="true"></i></span>
        <div>
          <h1 class="h4 mb-0">9RTKSync</h1>
          <p class="text-secondary small mb-0 font-monospace">
            {esc(router_url or translate("app.gateway_unset", lang))}
          </p>
        </div>
      </div>
      <div class="barra-acoes">
        {render_language_switcher(lang)}
        <form method="post" action="/acoes/cron" class="m-0">
          <button class="btn btn-primary btn-sm" type="submit">
            <i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>{esc(translate("action.sync_now", lang))}
          </button>
        </form>
        <button class="btn btn-outline-light btn-sm" type="button"
                data-bs-toggle="modal" data-bs-target="#modalSSO">
          <i class="bi bi-sliders me-1" aria-hidden="true"></i>{esc(translate("action.settings", lang))}
        </button>
        <form method="post" action="/logout" class="m-0">
          <button class="btn btn-outline-light btn-sm" type="submit">
            <i class="bi bi-box-arrow-right me-1" aria-hidden="true"></i>{esc(translate("auth.logout", lang))}
          </button>
        </form>
      </div>
    </header>

    <div class="row g-3 mb-4">{metrics}
    </div>

    <div class="row g-3 mb-4">
      <div class="col-lg-6">{render_gateway_card(gateway, db_path, lang)}</div>
      <div class="col-lg-6">{render_cron_card(cron, lang)}</div>
    </div>

    <div class="card mb-4">
      <div class="card-header d-flex align-items-center justify-content-between">
        <span class="d-inline-flex align-items-center gap-2">
          <i class="bi bi-list-check" aria-hidden="true"></i>{esc(translate("connections.title", lang))}
        </span>
        <span class="badge text-bg-dark">{len(connections)}</span>
      </div>
      {render_connections_table(connections, refresh_margin, lang)}
    </div>

    <div class="card mb-4">
      <div class="card-header d-flex align-items-center justify-content-between">
        <span class="d-inline-flex align-items-center gap-2">
          <i class="bi bi-key" aria-hidden="true"></i>{esc(translate("keys.title", lang))}
        </span>
        <span class="badge text-bg-dark">{len(keys)}</span>
      </div>
      {render_keys_table(keys, lang)}
    </div>

    <div class="card mb-4">
      <div class="card-header d-flex align-items-center justify-content-between">
        <span class="d-inline-flex align-items-center gap-2">
          <i class="bi bi-cpu" aria-hidden="true"></i>{esc(translate("models.title", lang))}
        </span>
        <span class="badge text-bg-dark">{len(models)}</span>
      </div>
      {render_models_table(models, lang, models_state)}
    </div>

    <div class="card mb-4">
      <div class="card-header d-flex align-items-center justify-content-between">
        <span class="d-inline-flex align-items-center gap-2">
          <i class="bi bi-diagram-3" aria-hidden="true"></i>{esc(translate("combos.title", lang))}
        </span>
        <span class="badge text-bg-dark">{len(combos)}</span>
      </div>
      {render_combos_table(combos, lang)}
    </div>

    <footer class="d-flex flex-wrap justify-content-between gap-2 text-secondary small pb-3">
      <span>
        <i class="bi bi-person-circle me-1" aria-hidden="true"></i>{esc(translate("footer.signed_in", lang))}
        <span class="font-monospace">{esc(current_user)}</span>
        <button class="btn btn-link btn-sm p-0 ms-2 align-baseline text-secondary"
                data-bs-toggle="modal" data-bs-target="#modalCredenciais">
          <i class="bi bi-key me-1" aria-hidden="true"></i>{esc(translate("action.change_credentials", lang))}
        </button>
      </span>
      <span>
        <i class="bi bi-clock-history me-1" aria-hidden="true"></i>{esc(translate("footer.generated", lang))}
        <span class="font-monospace">{esc(generated_at)}</span>
      </span>
    </footer>
  </div>

  <div class="modal fade" id="modalHistorico" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title h6 d-inline-flex align-items-center gap-2">
            <i class="bi bi-list-columns-reverse" aria-hidden="true"></i>{esc(translate("cron.title", lang))}
          </h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal"
                  aria-label="{esc(translate("action.close", lang))}"></button>
        </div>
        <div class="modal-body">{render_cron_history(cron.get("history") or [], lang)}
        </div>
      </div>
    </div>
  </div>

  <div class="modal fade" id="modalCredenciais" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title h6 d-inline-flex align-items-center gap-2">
            <i class="bi bi-shield-lock" aria-hidden="true"></i>{esc(translate("auth.title", lang))}
          </h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal"
                  aria-label="{esc(translate("action.close", lang))}"></button>
        </div>
        <div class="modal-body">{change_password_block}
        </div>
      </div>
    </div>
  </div>

  {render_sso_modal(sso_view, lang)}

  <script src="{JQUERY_JS}"></script>
  <script src="{BOOTSTRAP_JS}"></script>
  <script>
    // A página é renderizada no servidor; o jQuery só cuida de conforto de uso.
    jQuery(function ($) {{
      $('form[action^="/acoes/"]').not('[action="/acoes/idioma"]').on('submit', function () {{
        $(this).find('button[type=submit]')
               .prop('disabled', true)
               .find('i').attr('class', 'bi bi-hourglass-split me-1');
      }});

      // O aviso da ultima acao viaja na querystring (POST-Redirect-GET, para o
      // F5 nao repetir a acao). O efeito colateral e que ele fica: a URL guarda
      // o texto, e recarregar traz de volta uma mensagem de algo que ja
      // aconteceu. Assim que a pagina desenha, a querystring e limpa do
      // historico -- sem nova requisicao -- e o aviso some sozinho.
      var $aviso = $('[data-aviso]');
      if ($aviso.length) {{
        if (window.history.replaceState) {{
          window.history.replaceState({{}}, document.title, window.location.pathname);
        }}
        window.setTimeout(function () {{
          $aviso.fadeOut(400, function () {{ $(this).remove(); }});
        }}, 6000);
      }}
    }});
  </script>
</body>
</html>"""

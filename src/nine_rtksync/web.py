"""Multi-threaded HTTP server and embedded web dashboard."""

import base64
import json
import logging
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from typing import Any, Callable, Dict, Optional

from urllib.parse import parse_qs, urlparse

from .gateway import CATALOGO_INACESSIVEL, carregar_painel, esquece_o_catalogo, sondar
from .config import Settings
from .i18n import DEFAULT_LANGUAGE, normalize_language, translate
from .identidade import NOME_DO_GATEWAY, NOME_DO_PRODUTO
from .prefs import get_preference, resolve_prefs_path, set_preference
from . import protecao, sessao, sso
from .render import (
    render_dashboard,
    render_landing_page,
    render_login_page,
    render_notice_page,
)

# O detalhe de uma recusa de SSO vai para o log interno; a tela recebe sempre a
# mesma frase. Nada do que passa por aqui carrega segredo: nem o code, nem os
# tokens, nem o segredo do cliente.
_log = logging.getLogger(__name__)

# Tempo de vida do resultado da sondagem ao gateway. O /healthz é chamado a cada
# 15s pelo Docker; sem cache, cada chamada faria uma requisição HTTP de saída de
# até 3s, atrasando a resposta além do timeout do probe.
ROUTER_PROBE_TTL_SECONDS = 30.0

# Tempo de vida do catalogo de modelos. Ele sai de uma requisicao HTTP ao
# gateway e muda de hora em hora, nao a cada F5: sem cache, cada recarga da
# pagina -- e cada POST-Redirect-GET de acao -- pagaria a viagem de novo.

# Erros de socket que significam apenas "o cliente desistiu antes de ler a
# resposta" — comportamento normal de health check, não falha do servidor.
CLIENT_DISCONNECT_ERRORS = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)

# Cache do resultado da sondagem ao gateway, compartilhado entre as threads do servidor.
_router_probe_cache: Dict[str, tuple] = {}
_router_probe_lock = threading.Lock()

# Cache do catalogo de modelos, pela mesma razao e com a mesma disciplina.


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Servidor multi-thread que não polui o log quando o cliente desconecta antes da hora."""

    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, CLIENT_DISCONNECT_ERRORS):
            return
        super().handle_error(request, client_address)


class DashboardHandler(BaseHTTPRequestHandler):
    """HTTP handler serving dashboard UI, REST API, and cron scheduler with Basic Auth."""

    # O cabecalho Server ia na PRIMEIRA linha de toda resposta -- inclusive no
    # 401, antes de qualquer autenticacao -- anunciando "BaseHTTP/0.6
    # Python/3.14.7", ou seja, a versao exata do interpretador, logo acima da
    # CSP e do X-Frame-Options que o resto do cabecalho instala. Versao exata e
    # o que um scanner precisa para escolher o exploit certo.
    #
    # version_string() tambem e sobrescrito porque o BaseHTTPRequestHandler
    # concatena server_version + " " + sys_version: com sys_version vazio, a
    # resposta sai com um espaco sobrando no fim do valor.
    server_version = NOME_DO_PRODUTO
    sys_version = ""

    def version_string(self) -> str:
        return self.server_version


    settings: Optional[Settings] = None
    sync_trigger_callback: Optional[Callable[[], Dict[str, Any]]] = None
    cron_scheduler: Optional[Any] = None
    db_path: str = ""
    router_url: str = ""
    _last_gw_check: float = 0.0
    _last_gw_ok: bool = True

    def log_message(self, format, *args):
        pass

    def check_auth(self) -> bool:
        if not self.settings:
            return True

        # Duas portas, e elas NAO servem ao mesmo visitante.
        #
        # O cookie e a porta do navegador, e e a unica que tem tranca do lado de
        # dentro: "Sair" apaga o cookie e acabou. O Basic Auth nao tem logout --
        # o navegador guarda a credencial e a reenvia sozinho ate a janela
        # fechar, e nao existe cabecalho que mande ele esquecer. Enquanto a
        # navegacao aceitava Basic, o botao Sair apagava o cookie e a proxima
        # visita entrava de novo pela outra porta: o botao mentia.
        #
        # Por isso quem pede HTML (um navegador) precisa de SESSAO, e so. Quem
        # nao pede HTML -- curl, script, monitoramento -- continua com Basic
        # Auth, que e o esquema que essas ferramentas sabem usar sem guardar
        # estado, e para as quais "sair" nao quer dizer nada.
        if sessao.usuario_da_sessao(sessao.ler_do_cabecalho(self.headers.get("Cookie", ""))):
            return True

        if "text/html" in self.headers.get("Accept", ""):
            return False

        auth_header = self.headers.get("Authorization", "")
        if not auth_header or not auth_header.startswith("Basic "):
            return False

        try:
            b64_val = auth_header[6:].strip()
            decoded = base64.b64decode(b64_val).decode("utf-8")
            if ":" not in decoded:
                return False
            user, pwd = decoded.split(":", 1)
            # Delega ao Settings: credenciais salvas, padrão de fábrica e a
            # credencial de recuperação (admin + hash) são avaliadas lá.
            return self.settings.verify_credentials(user, pwd)
        except Exception:
            return False

    def require_auth(self) -> bool:
        if self.check_auth():
            return True

        lang = self.resolve_language()

        # Quem pediu HTML e um navegador: mandamos para o formulario, que e
        # pagina nossa -- traduzida, com a cara do painel e com logout. O 401
        # com WWW-Authenticate fica para quem NAO pediu HTML (curl, scripts,
        # monitoramento), que e quem sabe responder a ele.
        aceita = self.headers.get("Accept", "")
        if "text/html" in aceita and urlparse(self.path).path != "/login":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/login")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False

        payload = render_notice_page(
            translate("auth.required", lang), translate("auth.required_body", lang)
        )
        self.send_response(HTTPStatus.UNAUTHORIZED)
        self.send_header("WWW-Authenticate", f'Basic realm="{NOME_DO_PRODUTO} Dashboard"')
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.write_body(payload)
        return False

    # Politica de seguranca aplicada a TODAS as respostas, nao so a pagina
    # principal: o 401, o aviso de credenciais trocadas e os redirects tambem
    # sao HTML que o navegador renderiza.
    SECURITY_HEADERS = (
        ("Referrer-Policy", "no-referrer"),
        ("X-Content-Type-Options", "nosniff"),
        ("X-Frame-Options", "DENY"),
        (
            "Content-Security-Policy",
            # Restrita ao que a pagina realmente carrega: Bootstrap e os icones
            # vem do jsDelivr, as fontes do Google. connect-src 'self' porque o
            # painel e inteiramente renderizado no servidor, entao um HTML
            # injetado nao tem para onde exfiltrar.
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net "
            "https://fonts.googleapis.com; "
            "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:; "
            # As bandeiras do seletor de idioma sao SVG que o CSS do
            # flag-icons busca no mesmo CDN. Sem esta origem elas
            # simplesmente nao aparecem, sem erro visivel na tela.
            "img-src 'self' data: https://cdn.jsdelivr.net; "
            "connect-src 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'none'"
        ),
    )

    def end_headers(self):
        """Injeta os cabecalhos de seguranca antes de fechar o bloco."""
        enviados = {k.lower() for k, _ in self._headers_buffer_names()}
        for nome, valor in self.SECURITY_HEADERS:
            if nome.lower() not in enviados:
                self.send_header(nome, valor)
        super().end_headers()

    def _headers_buffer_names(self):
        """Nomes ja enfileirados nesta resposta, para nao duplicar cabecalho."""
        for linha in getattr(self, "_headers_buffer", []) or []:
            try:
                texto = linha.decode("latin-1", "ignore")
            except Exception:
                continue
            if ":" in texto:
                yield texto.split(":", 1)[0].strip(), texto


    # Rotas que este servidor conhece. Serve para uma so decisao, tomada ANTES
    # de exigir sessao: o que nao esta aqui e 404, e nao um convite a fazer
    # login para depois descobrir que a pagina nunca existiu.
    #
    # Rota REAL e protegida continua mandando para /login -- e a diferenca entre
    # "voce precisa entrar" e "isso nao existe", que sao respostas diferentes
    # para perguntas diferentes.
    ROTAS_CONHECIDAS = {
        "/", "/index.html", "/healthz", "/login", "/logout", "/robots.txt",
        "/favicon.ico", "/credenciais-atualizadas", "/logs",
    }
    # "/sso/" entra aqui, e nao em ROTAS_CONHECIDAS uma a uma, para que a ida e
    # a volta do provedor de identidade nao virem 404 antes de serem tratadas.
    PREFIXOS_CONHECIDOS = ("/api/", "/acoes/", "/sso/")

    def rota_existe(self, caminho: str) -> bool:
        return caminho in self.ROTAS_CONHECIDAS or caminho.startswith(self.PREFIXOS_CONHECIDOS)

    def recusa_rota_desconhecida(self, caminho: str) -> bool:
        """Devolve True e responde 404 quando a rota nao existe neste servidor."""
        if self.rota_existe(caminho):
            return False
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")
        return True

    def do_GET(self):
        if self.recusa_rota_desconhecida(urlparse(self.path).path):
            return
        if self.path == "/healthz":
            self.serve_healthz()
            return

        # Servida antes de require_auth de proposito: o navegador ainda esta
        # com a senha antiga neste instante, e exigir autenticacao aqui daria
        # um 401 cru exatamente depois de a troca ter dado certo.
        if urlparse(self.path).path == "/credenciais-atualizadas":
            self.serve_credentials_updated()
            return

        # A pagina de login e publica por definicao: exigir sessao para exibir
        # o formulario que cria a sessao seria um circulo fechado.
        # Publico de proposito, e servido antes da sessao: um rastreador nao
        # tem credencial, e a unica forma de ele ler a regra e ela nao exigir
        # uma. O painel nao deve aparecer em indice de busca nenhum.
        if urlparse(self.path).path == "/robots.txt":
            corpo = b"User-agent: *\nDisallow: /\n"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.write_body(corpo)
            return

        if urlparse(self.path).path == "/login":
            self.serve_login_page()
            return

        # A ida ao provedor de identidade e a volta dele acontecem SEM sessao --
        # e a sessao que elas existem para criar. As duas passam pelo mesmo teto
        # de tentativas do login, e as duas respondem 404 enquanto o SSO nao
        # estiver configurado e ligado.
        if urlparse(self.path).path == "/sso/oidc/iniciar":
            self.serve_sso_iniciar()
            return

        if urlparse(self.path).path == "/sso/oidc/callback":
            self.serve_sso_callback()
            return

        if not self.require_auth():
            return

        route = urlparse(self.path)
        if route.path in ("/", "/index.html"):
            self.serve_dashboard(query=parse_qs(route.query))
        elif route.path == "/api/status":
            self.serve_api_status()
        elif route.path == "/api/cron-status":
            self.serve_cron_status()
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Page not found")

    def is_same_origin_request(self) -> bool:
        """Rejeita POST disparado por outro site.

        O Basic Auth e anexado automaticamente pelo navegador mesmo em um POST
        vindo de outra origem, e um formulario urlencoded nao dispara preflight.
        Sem esta checagem, uma pagina maliciosa aberta na mesma maquina poderia
        trocar a senha do painel.

        A ordem importa: o Origin e a evidencia forte e e avaliado primeiro.
        Checar Sec-Fetch-Site antes disso fazia um valor inesperado do navegador
        recusar a requisicao mesmo com o Origin batendo com o Host. Nao se usa
        Referer porque a propria pagina e servida com Referrer-Policy: no-referrer.
        """
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin", "")

        if origin and origin != "null":
            # Comparacao pelo host declarado: mesma origem, requisicao legitima.
            if urlparse(origin).netloc == host:
                return True
            # Origin presente e divergente e a unica prova positiva de ataque.
            return False

        fetch_site = self.headers.get("Sec-Fetch-Site", "")
        if fetch_site:
            # "none" e a navegacao digitada na barra de enderecos.
            return fetch_site in ("same-origin", "none")

        # Cliente que nao e navegador (curl, script): nao ha sessao a sequestrar.
        return True

    def do_POST(self):
        rota_inicial = urlparse(self.path).path
        if rota_inicial == "/login":
            self.handle_login()
            return
        if rota_inicial == "/logout":
            self.handle_logout()
            return

        if not self.require_auth():
            return

        if not self.is_same_origin_request():
            # Devolve o usuario para o painel explicando o motivo, em vez de uma
            # pagina de erro crua sem caminho de volta.
            self.redirect_to_dashboard(
                "danger", translate("security.cross_origin", self.resolve_language())
            )
            return

        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length) if length > 0 else b"{}"

        route = urlparse(self.path).path

        # Acoes do dashboard: executam e redirecionam de volta para a pagina
        # renderizada (POST-Redirect-GET), sem JSON no navegador.
        if route.startswith("/acoes/"):
            self.handle_dashboard_action(route, raw_body)
            return

        if route == "/api/sync":
            self.handle_sync_request()
        elif route == "/api/test-gateway":
            self.handle_test_gateway()
        elif route == "/api/change-password":
            self.handle_change_password(raw_body)
        elif route == "/api/cron-run":
            self.handle_cron_run()
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found")

    def redirect_to_dashboard(self, tone: str, message: str) -> None:
        """Redireciona para a pagina com uma mensagem de resultado."""
        from urllib.parse import urlencode

        query = urlencode({"aviso": message, "tom": tone})
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", f"/?{query}")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def invalidate_caches(self) -> None:
        """Descarta o que foi memorizado para que a proxima renderizacao releia tudo.

        Sem isto, o resultado da sondagem ao gateway continuaria valendo por ate
        30s e o painel exibiria um estado anterior a acao que o usuario acabou
        de disparar.
        """
        with _router_probe_lock:
            _router_probe_cache.clear()
        esquece_o_catalogo()

    def handle_dashboard_action(self, route: str, raw_body: bytes) -> None:
        """Executa uma acao do painel e devolve o usuario para a pagina renderizada."""
        if route == "/acoes/atualizar":
            # Recarga completa: zera os caches e volta para a pagina, que e
            # montada de novo no servidor a partir do banco.
            self.invalidate_caches()
            self.redirect_to_dashboard("info", translate("action.refreshed", self.resolve_language()))
            return

        if route == "/acoes/sincronizar":
            if not type(self).sync_trigger_callback:
                self.redirect_to_dashboard("warning", "Sincronizacao manual indisponivel nesta instancia.")
                return
            try:
                res = type(self).sync_trigger_callback() or {}
                # A sincronizacao muda o estado do gateway: o cache anterior
                # deixaria a tela mostrando o mundo de antes da acao.
                self.invalidate_caches()
                self.redirect_to_dashboard(
                    "success",
                    f"Sincronizacao concluida: {res.get('total_connections', 0)} conexoes inspecionadas, "
                    f"{res.get('normalized', 0)} normalizadas, {res.get('refreshed', 0)} renovadas.",
                )
            except Exception as e:
                self.redirect_to_dashboard("danger", f"Falha na sincronizacao: {e}")
            return

        if route == "/acoes/cron":
            if not self.cron_scheduler:
                self.redirect_to_dashboard("warning", "Agendador nao esta ativo nesta instancia.")
                return
            try:
                entry = self.cron_scheduler.trigger_now() or {}
                self.redirect_to_dashboard(
                    "success",
                    f"Ciclo executado em {entry.get('durationMs', 0)}ms: "
                    f"{entry.get('totalInspected', 0)} avaliadas, {entry.get('refreshedCount', 0)} renovadas.",
                )
            except Exception as e:
                self.redirect_to_dashboard("danger", f"Falha ao executar o ciclo: {e}")
            return

        if route == "/acoes/testar-gateway":
            # Zera TUDO o que foi memorizado sobre o gateway, e nao so a
            # sondagem: o catalogo de modelos tambem sai dele. Enquanto este
            # ramo descartava apenas a sondagem, o operador clicava "Testar
            # conexao", via o gateway voltar a responder, e o cartao de modelos
            # continuava dizendo "nao respondeu" por ate dois minutos.
            self.invalidate_caches()
            online = self.probe_router()
            self.redirect_to_dashboard(
                "success" if online else "danger",
                "Gateway respondeu normalmente." if online else "Gateway nao respondeu.",
            )
            return

        if route == "/acoes/idioma":
            fields = parse_qs(raw_body.decode("utf-8", errors="replace"))
            chosen = normalize_language((fields.get("lang", [""])[0] or "").strip())
            # Gravar pode falhar -- disco cheio, arquivo sem permissao de escrita.
            # Redirecionar com sucesso nesse caso deixava o usuario clicando na
            # bandeira sem entender por que a tela volta no idioma anterior: o
            # painel dizia "pronto" e nada acontecia.
            if not set_preference(self.prefs_path(), "language", chosen):
                self.redirect_to_dashboard("danger", translate("language.save_failed", chosen))
                return
            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Location", "/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if route == "/acoes/sso":
            self.handle_sso_settings(raw_body)
            return

        if route == "/acoes/credenciais":
            fields = parse_qs(raw_body.decode("utf-8", errors="replace"))
            new_user = (fields.get("user", [""])[0] or "").strip()
            new_pass = (fields.get("password", [""])[0] or "").strip()

            # A politica de forca e obrigatoria: devolve todas as regras
            # violadas de uma vez, no idioma escolhido, em vez de recusar sem
            # dizer o motivo.
            problems = self.settings.check_password_strength(new_pass) if self.settings else []
            if problems:
                lang = self.resolve_language()
                self.redirect_to_dashboard(
                    "danger", " ".join(translate(key, lang) for key in problems)
                )
                return
            if self.settings and getattr(self.settings, "dashboard_auth_from_env", False):
                self.redirect_to_dashboard(
                    "warning",
                    "Credenciais definidas por variavel de ambiente. Altere-as no ambiente e reinicie.",
                )
                return
            if self.settings and self.settings.update_auth_credentials(new_user, new_pass):
                self.send_response(HTTPStatus.SEE_OTHER)
                self.send_header("Location", "/credenciais-atualizadas")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.redirect_to_dashboard("danger", "Nao foi possivel salvar as credenciais.")
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Acao nao encontrada")

    def probe_router(self) -> bool:
        """Sonda o gateway com cache: o resultado vale por ROUTER_PROBE_TTL_SECONDS.

        Quem faz a pergunta e `gateway.sondar`, que sabe o endereco e o que conta
        como "respondeu" NESTE gateway. Aqui fica so o cache -- que e comum aos
        tres, porque o /healthz e chamado a cada 15s pelo Docker e sem cache cada
        chamada pagaria uma requisicao de saida.
        """
        if not self.router_url:
            return True

        now = time.time()
        with _router_probe_lock:
            cached_at, cached_ok = _router_probe_cache.get(self.router_url, (0.0, None))
            if cached_ok is not None and (now - cached_at) < ROUTER_PROBE_TTL_SECONDS:
                return cached_ok

        router_ok = bool(sondar(self.router_url)["online"])

        with _router_probe_lock:
            _router_probe_cache[self.router_url] = (time.time(), router_ok)
        return router_ok

    def write_body(self, payload: bytes) -> None:
        """Escreve o corpo tolerando o cliente ter fechado a conexão antes da leitura."""
        try:
            self.wfile.write(payload)
        except CLIENT_DISCONNECT_ERRORS:
            self.close_connection = True

    def serve_login_page(self, erro: str = "", apaga_estado: bool = False) -> None:
        """Formulario de entrada: a porta do navegador para o painel."""
        lang = self.resolve_language()
        # O desafio so entra depois de algumas falhas: quem acerta de primeira
        # nunca o ve, e quem insiste passa a pagar CPU por tentativa.
        endereco = protecao.endereco_do_cliente(self.client_address)
        desafio = protecao.novo_desafio() if protecao.precisa_de_desafio(endereco) else ""
        dificuldade = protecao.dificuldade_para(endereco)
        payload = render_login_page(lang, erro, desafio, dificuldade, self.nome_do_provedor_sso())
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        if apaga_estado:
            # O cookie de estado e de uso unico: recusado o retorno, ele sai
            # junto, para que uma segunda volta com o mesmo `state` nao encontre
            # nada com que comparar.
            self.send_header("Set-Cookie", sessao.cabecalho_para_apagar_estado())
        self.end_headers()
        self.write_body(payload)

    # --- SSO ---------------------------------------------------------------

    def sso_base_dir(self) -> str:
        """Diretorio do segredo do cliente: o mesmo das credenciais locais.

        Nunca $HOME por atalho -- o segredo tem de cair no volume de dados, ou
        ele some quando o container e recriado e o SSO se desliga sozinho.
        """
        if not self.settings:
            return ""
        return os.path.dirname(self.settings.get_auth_file_path())

    def sso_config(self) -> Optional[Dict[str, Any]]:
        """Configuracao em vigor, ou None quando o SSO nao deve funcionar."""
        if not self.settings:
            return None
        return sso.configuracao_efetiva(self.prefs_path(), self.sso_base_dir())

    def nome_do_provedor_sso(self) -> str:
        """Nome exibido no botao da tela de login. Vazio quando nao ha botao.

        A descoberta e consultada aqui de proposito: se o provedor de identidade
        nao responde, o botao SOME em vez de levar a uma falha generica. O
        formulario local nunca sai da tela.
        """
        config = self.sso_config()
        if not config:
            return ""
        if not sso.descobre(str(config["issuer"])):
            return ""
        return sso.nome_do_provedor(config)

    def serve_sso_iniciar(self) -> None:
        """Sorteia o estado, grava o cookie de ida e manda o navegador ao provedor."""
        endereco = protecao.endereco_do_cliente(self.client_address)
        pode, espere = protecao.registra_tentativa(endereco)
        if not pode:
            self.responde_429(espere)
            return

        config = self.sso_config()
        if not config:
            # Sem configuracao a rota nao existe, pelo mesmo caminho de qualquer
            # outra rota inexistente: nada anuncia que ha um SSO desligado aqui.
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        documento = sso.descobre(str(config["issuer"]))
        if not documento:
            self.serve_login_page(translate("sso.failed", self.resolve_language()))
            return

        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verificador = sso.novo_verificador()

        self.send_response(HTTPStatus.FOUND)
        self.send_header(
            "Location", sso.url_de_autorizacao(config, documento, state, nonce, verificador)
        )
        self.send_header(
            "Set-Cookie",
            sessao.cabecalho_para_gravar_estado(
                sessao.emitir_estado_sso(state, nonce, verificador)
            ),
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_sso_callback(self) -> None:
        """Valida a volta do provedor e emite o MESMO cookie do formulario local."""
        endereco = protecao.endereco_do_cliente(self.client_address)
        pode, espere = protecao.registra_tentativa(endereco)
        if not pode:
            self.responde_429(espere)
            return

        lang = self.resolve_language()
        config = self.sso_config()
        if not config:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        estado = sessao.ler_estado_sso(
            sessao.ler_estado_do_cabecalho(self.headers.get("Cookie", ""))
        )
        parametros = {
            chave: valores[0]
            for chave, valores in parse_qs(urlparse(self.path).query).items()
            if valores
        }

        email, motivo = sso.conclui_login(
            config=config, estado=estado, parametros=parametros
        )
        if not email:
            # Uma frase so na tela; o detalhe fica no log, sem o code e sem token.
            _log.warning("SSO: entrada recusada -- %s", motivo)
            protecao.anota_falha(endereco)
            self.serve_login_page(translate("sso.failed", lang), apaga_estado=True)
            return

        protecao.limpa_apos_sucesso(endereco)
        _log.info("SSO: sessao emitida para uma identidade federada")

        # NAO e um 302 para "/". O Chrome nao envia um cookie SameSite=Strict no
        # salto seguinte de uma cadeia de redirecionamento iniciada em outro
        # site: o operador cairia em /login com a sessao valida no bolso. A
        # pagina de pouso e navegacao nova, e o cookie viaja nela.
        payload = render_landing_page(lang)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Set-Cookie", sessao.cabecalho_para_gravar(sessao.emitir("sso:" + email))
        )
        # O cookie de ida ja cumpriu o papel: uso unico.
        self.send_header("Set-Cookie", sessao.cabecalho_para_apagar_estado())
        self.end_headers()
        self.write_body(payload)

    def sso_view(self) -> Dict[str, Any]:
        """O que a tela de configuracao precisa saber. NUNCA o segredo do cliente.

        Um GET de configuracao jamais devolve o valor gravado: a tela recebe
        apenas a informacao de que EXISTE um segredo, e um campo para substitui-lo.
        """
        if not self.settings:
            return {}
        config = sso.ler_configuracao(self.prefs_path())
        base = sso.normaliza_base_url(config.get("base_url", ""))
        return {
            "config": config,
            "tem_segredo": bool(sso.ler_segredo(self.sso_base_dir())),
            "segredo_do_ambiente": sso.segredo_vem_do_ambiente(),
            "desligado_por_ambiente": sso.desligado_por_ambiente(),
            "saml_disponivel": sso.saml_disponivel(),
            "callback_url": f"{base}{sso.ROTA_CALLBACK}" if base else "",
        }

    def confere_senha_local(self, senha: str) -> bool:
        """Confere a senha do PAINEL, nunca a identidade federada da sessao.

        Quem entrou pelo provedor de identidade nao tem senha local -- e
        exatamente por isso ela e exigida aqui: e o que um cookie sequestrado nao
        entrega.
        """
        if not self.settings or not senha:
            return False
        guardadas = self.settings.get_stored_credentials()
        usuario = guardadas[0] if guardadas else (self.settings.dashboard_user or "admin")
        return self.settings.verify_credentials(usuario, senha)

    def handle_sso_settings(self, raw_body: bytes) -> None:
        """Grava a configuracao de SSO. Exige a senha local atual, alem da sessao."""
        lang = self.resolve_language()
        endereco = protecao.endereco_do_cliente(self.client_address)
        pode, espere = protecao.registra_tentativa(endereco)
        if not pode:
            self.responde_429(espere)
            return

        campos_crus = parse_qs(raw_body.decode("utf-8", errors="replace"))

        def campo(nome: str) -> str:
            return (campos_crus.get(nome, [""])[0] or "").strip()

        # Sem isto, sequestrar uma sessao de oito horas bastaria para apontar o
        # painel a um provedor de identidade hostil e se por na lista de
        # permissao -- persistencia permanente a partir de um cookie roubado.
        if not self.confere_senha_local(campo("senha_atual")):
            protecao.anota_falha(endereco)
            self.redirect_to_dashboard("danger", translate("sso.wrong_password", lang))
            return

        if sso.desligado_por_ambiente():
            self.redirect_to_dashboard("warning", translate("sso.disabled_by_env", lang))
            return

        campos = {
            "enabled": campo("enabled"),
            "base_url": campo("base_url"),
            "issuer": campo("issuer"),
            "client_id": campo("client_id"),
            "scopes": campo("scopes"),
            "allowed_domains": campo("allowed_domains"),
            "allowed_emails": campo("allowed_emails"),
        }
        if campos["enabled"] not in sso.PROVEDORES:
            self.redirect_to_dashboard("danger", translate("sso.save_failed", lang))
            return

        base_dir = self.sso_base_dir()
        novo_segredo = campo("client_secret")
        if novo_segredo and not sso.segredo_vem_do_ambiente():
            if not sso.grava_segredo(base_dir, novo_segredo):
                self.redirect_to_dashboard("danger", translate("sso.secret_failed", lang))
                return
        # Campo em branco MANTEM o segredo anterior. Quem reabre a tela para
        # corrigir a lista de permissao nao digita o segredo de novo, e apagar o
        # que funciona por causa de um campo vazio seria desligar o SSO em
        # silencio.
        tem_segredo = bool(sso.ler_segredo(base_dir))

        if campos["enabled"] == "oidc":
            problemas = sso.problemas_da_configuracao(campos, tem_segredo)
            if problemas:
                self.redirect_to_dashboard(
                    "danger", " ".join(translate(chave, lang) for chave in problemas)
                )
                return

        if not sso.grava_configuracao(self.prefs_path(), campos):
            self.redirect_to_dashboard("danger", translate("sso.save_failed", lang))
            return

        # O emissor pode ter mudado: o documento memorizado do anterior nao vale
        # mais nada.
        sso.limpa_cache_descoberta()
        self.redirect_to_dashboard("success", translate("sso.saved", lang))

    def handle_login(self) -> None:
        """Valida a credencial do formulario e emite o cookie de sessao."""
        endereco = protecao.endereco_do_cliente(self.client_address)

        # Teto por janela: o que para o script que tenta mil senhas por minuto.
        pode, espere = protecao.registra_tentativa(endereco)
        if not pode:
            self.responde_429(espere)
            return

        length = int(self.headers.get("Content-Length", 0))
        corpo = self.rfile.read(length) if length > 0 else b""
        campos = parse_qs(corpo.decode("utf-8", "replace"))
        usuario = (campos.get("usuario") or [""])[0]
        senha = (campos.get("senha") or [""])[0]

        # Depois de algumas falhas, o formulario so e aceito com a prova de
        # trabalho resolvida. Custa CPU para quem tenta em massa e e instantanea
        # de conferir aqui.
        if protecao.precisa_de_desafio(endereco):
            desafio = (campos.get("desafio") or [""])[0]
            resposta = (campos.get("resposta") or [""])[0]
            if not protecao.resposta_confere(
                desafio, resposta, protecao.dificuldade_para(endereco)
            ):
                protecao.anota_falha(endereco)
                self.serve_login_page(translate("auth.login_failed", self.resolve_language()))
                return

        # A espera cresce a cada falha seguida. E do lado do servidor: nao ha
        # nada no cliente para desligar.
        atraso = protecao.espera_por_falhas(endereco)
        if atraso:
            time.sleep(atraso)

        if not self.settings or not self.settings.verify_credentials(usuario, senha):
            # Mensagem unica para usuario errado e senha errada: distinguir os
            # dois conta a quem tenta qual metade ja acertou.
            protecao.anota_falha(endereco)
            self.serve_login_page(translate("auth.login_failed", self.resolve_language()))
            return

        protecao.limpa_apos_sucesso(endereco)
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", "/")
        self.send_header("Set-Cookie", sessao.cabecalho_para_gravar(sessao.emitir(usuario)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def responde_429(self, espere_segundos: int) -> None:
        """Pedidos demais: 429 com Retry-After, que e o que um cliente correto le."""
        lang = self.resolve_language()
        payload = render_notice_page(
            translate("auth.too_many", lang),
            translate("auth.too_many_body", lang, seconds=espere_segundos),
        )
        self.send_response(HTTPStatus.TOO_MANY_REQUESTS)
        self.send_header("Retry-After", str(espere_segundos))
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.write_body(payload)

    def handle_logout(self) -> None:
        """Apaga o cookie. O Basic Auth nao tem equivalente disso."""
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", "/login")
        self.send_header("Set-Cookie", sessao.cabecalho_para_apagar())
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_credentials_updated(self):
        """Confirma a troca de senha sem exigir a credencial que acabou de mudar."""
        lang = self.resolve_language()
        payload = render_notice_page(
            translate("auth.updated_title", lang),
            translate("auth.updated_body", lang),
            translate("auth.updated_link", lang),
        )
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.write_body(payload)

    def serve_healthz(self):
        """Health check do Docker: barato, sem cache do navegador e sem excecao no log.

        A sondagem ao gateway passa por probe_router, que memoriza o resultado;
        sem isso cada probe pagava ate 3s de HTTP de saida e estourava o timeout
        do healthcheck, que fechava o socket e gerava BrokenPipeError.
        """
        db_ok = bool(self.db_path and os.path.exists(self.db_path))
        router_ok = self.probe_router()

        if db_ok and router_ok:
            status, payload = HTTPStatus.OK, b"OK"
        elif not db_ok:
            status, payload = HTTPStatus.SERVICE_UNAVAILABLE, b"DATABASE_NOT_READY"
        else:
            status, payload = HTTPStatus.SERVICE_UNAVAILABLE, b"ROUTER_SERVICE_UNREACHABLE"

        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.write_body(payload)

    def prefs_path(self) -> str:
        """Banco de preferencias proprio do sincronizador (nunca o do gateway)."""
        base = os.path.dirname(self.settings.get_auth_file_path()) if self.settings else ""
        return resolve_prefs_path(base or os.path.expanduser("~"))

    def resolve_language(self) -> str:
        """Idioma em vigor: preferencia salva no SQLite, senao o padrao (ingles)."""
        return normalize_language(get_preference(self.prefs_path(), "language", DEFAULT_LANGUAGE))

    def collect_dashboard_state(self) -> Dict[str, Any]:
        """Le tudo o que a pagina precisa. Roda no servidor: o SQLite nunca sai daqui."""
        # UMA chamada, com as oito chaves de sempre: daqui para baixo o painel
        # nao sabe se o gateway guarda isso em SQLite ou responde por HTTP.
        painel = carregar_painel(self.settings) if self.settings else {
            "connections": [], "keys": [], "models": [], "combos": [],
            "findings": [], "counters": {}, "probe": {},
            "model_states": {"catalog": CATALOGO_INACESSIVEL, "db": "missing"},
        }
        conns = painel["connections"]
        combos = painel["combos"]
        keys = painel["keys"]
        models = painel["models"]
        models_state = painel["model_states"]["catalog"]
        db_exists = painel["model_states"]["db"] == "ok"

        start_t = time.time()
        online = self.probe_router()
        latency_ms = int((time.time() - start_t) * 1000)

        return {
            "connections": conns,
            "combos": combos,
            "keys": keys,
            "models": models,
            "modelsState": models_state,
            "cron": self.cron_scheduler.get_status() if self.cron_scheduler else {"active": False},
            "gateway": {
                "url": self.router_url,
                "online": online,
                "statusCode": 200 if online else 0,
                "latencyMs": latency_ms,
                # Bandeira explicita: o resumo e texto para humano e vinha
                # sempre preenchido, inclusive com "Banco nao encontrado".
                # Converter esse texto em booleano fazia a tela declarar banco e
                # gateway 100% operacionais justamente quando o arquivo sumia.
                "dbOk": db_exists,
                # Numeros, e nao frase pronta: quem conhece o idioma
                # escolhido e o render. Enquanto a frase nascia aqui, a tela em
                # ingles exibia "Operacional (0 conexoes, 0 combos)".
                "dbConnections": len(conns),
                "dbCombos": len(combos),
            },
        }

    def serve_dashboard(self, query: Optional[Dict[str, list]] = None):
        """Renderiza a pagina inteira no servidor, com os dados ja embutidos."""
        query = query or {}
        state = self.collect_dashboard_state()

        flash = None
        aviso = (query.get("aviso") or [""])[0]
        if aviso:
            flash = {"message": aviso, "tone": (query.get("tom") or ["info"])[0]}

        current_user = "admin"
        is_default = False
        auth_from_env = False
        refresh_margin = 900
        if self.settings:
            current_user, _ = self.settings.get_auth_credentials()
            is_default = self.settings.is_default_password()
            auth_from_env = getattr(self.settings, "dashboard_auth_from_env", False)
            refresh_margin = self.settings.refresh_margin

        content = render_dashboard(
            sso_view=self.sso_view(),
            connections=state["connections"],
            combos=state["combos"],
            keys=state["keys"],
            models=state["models"],
            models_state=state["modelsState"],
            cron=state["cron"],
            gateway=state["gateway"],
            db_path=self.db_path,
            router_url=self.router_url,
            current_user=current_user,
            is_default_password=is_default,
            refresh_margin=refresh_margin,
            auth_from_env=auth_from_env,
            flash=flash,
            lang=self.resolve_language(),
        ).encode("utf-8")

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        # A pagina carrega dados vivos: nunca pode vir do cache do navegador.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.write_body(content)

    def serve_api_status(self):
        # A MESMA costura do painel: a API nao tem uma segunda leitura do
        # gateway, ou as duas telas divergiriam sem ninguem notar.
        painel = carregar_painel(self.settings) if self.settings else {"connections": [], "combos": []}
        conns = painel["connections"]
        combos = painel["combos"]

        cron_info = self.cron_scheduler.get_status() if self.cron_scheduler else {"active": False}
        is_default = self.settings.is_default_password() if self.settings else False
        cur_user, _ = self.settings.get_auth_credentials() if self.settings else ("admin", "")

        payload = {
            "status": "online",
            "routerUrl": self.router_url,
            "dbPath": self.db_path,
            "currentUser": cur_user,
            "isDefaultPassword": is_default,
            "cron": cron_info,
            "connections": [
                {
                    "id": c.id,
                    "provider": c.provider,
                    "name": c.name,
                    "isOAuth": c.is_oauth,
                    "hasApiKey": c.has_api_key,
                    "expiresAtMs": c.expires_at_ms,
                    "remainingSeconds": c.remaining_seconds,
                    "healthStatus": c.health_status,
                    "updatedAt": c.updated_at,
                }
                for c in conns
            ],
            "combos": combos,
        }
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.write_body(body)

    def serve_cron_status(self):
        cron_info = self.cron_scheduler.get_status() if self.cron_scheduler else {"active": False}
        body = json.dumps(cron_info, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.write_body(body)

    def handle_test_gateway(self):
        start_t = time.time()
        gateway_ok = False
        status_code = 0
        gateway_err = ""
        router_target = self.router_url

        try:
            req = urllib.request.Request(
                router_target,
                headers={"User-Agent": f"{NOME_DO_PRODUTO}-Tester/1.0"},
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                status_code = resp.status
                gateway_ok = status_code < 500
        except urllib.error.HTTPError as e:
            status_code = e.code
            gateway_ok = e.code < 500
        except Exception as ex:
            gateway_err = str(ex)

        latency_ms = int((time.time() - start_t) * 1000)

        db_exists = bool(self.db_path and os.path.exists(self.db_path))
        contagem = (carregar_painel(self.settings) if self.settings else {}).get("counters", {})
        conns_count = contagem.get("connections", 0)
        combos_count = contagem.get("combos", 0)

        result = {
            "success": gateway_ok and db_exists,
            "gatewayUrl": router_target,
            "gatewayStatus": "online" if gateway_ok else "offline",
            "httpStatusCode": status_code,
            "latencyMs": latency_ms,
            "gatewayError": gateway_err if not gateway_ok else None,
            "dbStatus": "ok" if db_exists else "not_found",
            "dbPath": self.db_path,
            "connectionsCount": conns_count,
            "combosCount": combos_count,
            "message": f"{NOME_DO_GATEWAY} gateway and SQLite database are 100% operational!" if (gateway_ok and db_exists) else f"Failed to connect to {NOME_DO_GATEWAY} or database unavailable",
        }

        body = json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.write_body(body)

    def handle_change_password(self, raw_body: bytes):
        try:
            data = json.loads(raw_body.decode("utf-8")) if raw_body else {}

            new_user = str(data.get("newUser") or "admin").strip()
            new_pass = str(data.get("newPassword") or "").strip()

            # Mesma politica de forca do formulario da tela.
            problems = self.settings.check_password_strength(new_pass) if self.settings else []
            if problems:
                lang = self.resolve_language()
                detail = " ".join(translate(key, lang) for key in problems)
                body = json.dumps({"success": False, "error": detail}).encode("utf-8")
                self.send_response(HTTPStatus.BAD_REQUEST)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.write_body(body)
                return

            if self.settings:
                ok = self.settings.update_auth_credentials(new_user, new_pass)
                if ok:
                    body = json.dumps({
                        "success": True,
                        "message": "Credentials updated successfully! Use your new username and password for future requests.",
                        "newUser": new_user,
                    }).encode("utf-8")
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.write_body(body)
                    return

            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Could not save credentials")
        except Exception as e:
            body = json.dumps({"success": False, "error": str(e)}).encode("utf-8")
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.write_body(body)

    def handle_sync_request(self):
        if DashboardHandler.sync_trigger_callback:
            try:
                res = DashboardHandler.sync_trigger_callback()
                body = json.dumps({"success": True, "result": res}).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.write_body(body)
                return
            except Exception as e:
                err = json.dumps({"success": False, "error": str(e)}).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.write_body(err)
                return
        self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "Synchronizer unavailable")

    def handle_cron_run(self):
        if DashboardHandler.cron_scheduler:
            try:
                entry = DashboardHandler.cron_scheduler.trigger_now()
                body = json.dumps({"success": True, "cycle": entry}).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.write_body(body)
                return
            except Exception as e:
                err = json.dumps({"success": False, "error": str(e)}).encode("utf-8")
                self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err)))
                self.end_headers()
                self.write_body(err)
                return
        self.handle_sync_request()


def start_web_server(
    host: str,
    port: int,
    db_path: str,
    router_url: str = "",
    sync_callback: Optional[Callable[[], Dict[str, Any]]] = None,
    settings: Optional[Settings] = None,
    cron_scheduler: Optional[Any] = None,
    ) -> ThreadingHTTPServer:
    """Start HTTP server on background thread with Basic Auth and Cron Scheduler."""
    DashboardHandler.db_path = db_path
    DashboardHandler.router_url = router_url
    DashboardHandler.sync_trigger_callback = sync_callback
    DashboardHandler.settings = settings
    DashboardHandler.cron_scheduler = cron_scheduler

    server = QuietThreadingHTTPServer((host, port), DashboardHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


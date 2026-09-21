"""O caminho feliz do SSO não prova nada. Estes testes exercitam o caminho ruim.

Um fluxo federado é uma sequência de conferências, e cada conferência que falta
é uma porta. Testar só a entrada bem-sucedida mede se a porta abre — não mede se
ela fecha, que é a única coisa que importa aqui.

O que cada bloco cobre:

- `EnderecoPublicoDoPainel`  o endereço de retorno nasce da configuração, e não
  do cabeçalho `Host`, que quem chama escolhe;
- `ListaDePermissao`         lista vazia nunca significa "todo mundo";
- `Descoberta`               o emissor do documento tem de ser o configurado;
- `CargaDoIdToken`           `iss`, `aud`, `azp`, `exp`, `iat` e `nonce`, um a um;
- `CookieDeEstado`           assinatura trocada, prazo vencido e a troca entre o
  cookie de estado e o de sessão;
- `VoltaDoProvedor`          o fluxo inteiro contra um provedor falso, com uma
  falha diferente por teste;
- `PainelDeVerdade`          um painel de pé e um provedor de identidade de pé,
  com `code` reapresentado, `state` trocado e cabeçalho `Host` hostil;
- `PendentesDoSaml`          o conjunto que dá sentido ao `InResponseTo` e o
  cache que impede a mesma asserção de valer duas vezes;
- `EnderecosDoSaml`          tudo o que o IdP recebe sai de `sso.base_url`, e
  nunca do cabeçalho `Host`.
"""

import base64
import http.client
import json
import os
import socket
import sqlite3
import tempfile
import threading
import time
import unittest
import urllib.parse
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from nine_rtksync import protecao, sessao, sso
from nine_rtksync.config import Settings
from nine_rtksync.web import start_web_server

CLIENT_ID = "cliente-do-painel"
CLIENT_SECRET = "segredo-de-teste-que-nunca-sai-daqui"


def _b64url(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).decode("ascii").rstrip("=")


def monta_id_token(carga: dict) -> str:
    """Um JWT com assinatura de enfeite.

    A assinatura NÃO é verificada aqui nem em produção: o token chega pelo canal
    direto com o `token_endpoint`, sobre TLS e com o cliente autenticado, que é o
    caso dispensado pela OIDC Core 3.1.3.7. Por isso o teste pode montar o token
    à mão sem mentir sobre o que o código faz.
    """
    cabecalho = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode("utf-8"))
    corpo = _b64url(json.dumps(carga).encode("utf-8"))
    return f"{cabecalho}.{corpo}.assinatura-de-enfeite"


def porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def permitido(email: str, dominios=(), emails=()) -> bool:
    """A lista de autorizados do núcleo, no formato curto que estes testes usam."""
    return sso.email_autorizado(
        email, sso.ConfiguracaoSSO(dominios=tuple(dominios), emails=tuple(emails))
    )


# --------------------------------------------------------------------------
# Configuração e listas
# --------------------------------------------------------------------------


class EnderecoPublicoDoPainel(unittest.TestCase):
    """Derivar o endereço de retorno do `Host` é a definição de redirecionamento aberto."""

    def test_aceita_origem_https_sem_caminho(self):
        self.assertTrue(sso.base_url_valida("https://painel.exemplo.com"))
        self.assertTrue(sso.base_url_valida("https://painel.exemplo.com/"))
        self.assertTrue(sso.base_url_valida("https://painel.exemplo.com:8443"))

    def test_recusa_caminho_consulta_e_fragmento(self):
        """Um caminho aqui vira um endereço de retorno que o provedor não reconhece."""
        for ruim in (
            "https://painel.exemplo.com/sub",
            "https://painel.exemplo.com/?x=1",
            "https://painel.exemplo.com/#a",
        ):
            self.assertFalse(sso.base_url_valida(ruim), ruim)

    def test_http_so_no_loopback(self):
        self.assertTrue(sso.base_url_valida("http://127.0.0.1:9091"))
        self.assertTrue(sso.base_url_valida("http://localhost:9091"))
        self.assertFalse(sso.base_url_valida("http://painel.exemplo.com"))

    def test_recusa_esquema_estranho(self):
        self.assertFalse(sso.base_url_valida("javascript:alert(1)"))
        self.assertFalse(sso.base_url_valida(""))

    def test_o_endereco_de_retorno_sai_da_configuracao(self):
        config = {"base_url": "https://painel.exemplo.com"}
        self.assertEqual(
            sso.redirect_uri(config), "https://painel.exemplo.com/sso/oidc/callback"
        )


class ListaDePermissao(unittest.TestCase):
    def test_lista_vazia_nao_deixa_ninguem_entrar(self):
        """Sem filtro, "entrar com o provedor X" significa que toda conta X entra."""
        self.assertFalse(permitido("qualquer@gmail.com", [], []))

    def test_dominio_autorizado(self):
        self.assertTrue(permitido("chefe@empresa.com", ["empresa.com"], []))
        self.assertFalse(permitido("chefe@outra.com", ["empresa.com"], []))

    def test_email_exato(self):
        self.assertTrue(permitido("chefe@empresa.com", [], ["chefe@empresa.com"]))
        self.assertFalse(permitido("outro@empresa.com", [], ["chefe@empresa.com"]))

    def test_um_dominio_parecido_nao_passa(self):
        """`empresa.com.br` não é `empresa.com`, e `naoempresa.com` também não."""
        self.assertFalse(permitido("a@empresa.com.br", ["empresa.com"], []))
        self.assertFalse(permitido("a@naoempresa.com", ["empresa.com"], []))

    def test_sem_arroba_nao_e_email(self):
        self.assertFalse(permitido("empresa.com", ["empresa.com"], []))

    def test_a_configuracao_recusa_ligar_sem_lista(self):
        campos = {
            "base_url": "https://painel.exemplo.com",
            "issuer": "https://accounts.exemplo.com",
            "client_id": CLIENT_ID,
            "allowed_domains": "",
            "allowed_emails": "",
        }
        self.assertIn("sso.need_allowlist", sso.problemas_da_configuracao(campos, True))

    def test_a_configuracao_recusa_ligar_sem_segredo(self):
        campos = {
            "base_url": "https://painel.exemplo.com",
            "issuer": "https://accounts.exemplo.com",
            "client_id": CLIENT_ID,
            "allowed_domains": "empresa.com",
            "allowed_emails": "",
        }
        self.assertEqual(sso.problemas_da_configuracao(campos, True), ())
        self.assertIn("sso.need_secret", sso.problemas_da_configuracao(campos, False))


class Descoberta(unittest.TestCase):
    """O provedor de mentira entra no lugar da ÚNICA saída de rede do módulo.

    Trocar `sso._pedir` -- e não passar um transporte por argumento -- é o que
    exercita o mesmo caminho que roda em produção: quem chama a descoberta no
    painel não escolhe transporte nenhum.
    """

    def setUp(self):
        sso.limpa_cache_descoberta()
        self.pedir_de_verdade = sso._pedir
        self.chamadas = []

    def tearDown(self):
        sso._pedir = self.pedir_de_verdade
        sso.limpa_cache_descoberta()

    def _documento(self, **troca):
        base = {
            "issuer": "https://accounts.exemplo.com",
            "authorization_endpoint": "https://accounts.exemplo.com/auth",
            "token_endpoint": "https://accounts.exemplo.com/token",
            "userinfo_endpoint": "https://accounts.exemplo.com/userinfo",
        }
        base.update(troca)
        return base

    def _responde(self, resposta):
        """Instala o provedor falso. `resposta` pode ser um documento ou um erro."""
        def falso(url, dados=None, cabecalhos=None, timeout=None):
            self.chamadas.append(url)
            if isinstance(resposta, Exception):
                raise resposta
            return resposta

        sso._pedir = falso

    def test_emissor_diferente_do_configurado_e_recusado(self):
        """É a defesa contra a confusão entre provedores: um só emissor legítimo."""
        self._responde(self._documento(issuer="https://outro.exemplo.com"))
        self.assertIsNone(sso.descobre("https://accounts.exemplo.com"))

    def test_ponto_de_acesso_em_http_e_recusado(self):
        self._responde(self._documento(token_endpoint="http://accounts.exemplo.com/token"))
        self.assertIsNone(sso.descobre("https://accounts.exemplo.com"))

    def test_documento_bom_passa_e_fica_memorizado(self):
        doc = self._documento()
        self._responde(doc)
        self.assertEqual(sso.descobre("https://accounts.exemplo.com"), doc)
        self.assertEqual(sso.descobre("https://accounts.exemplo.com"), doc)
        self.assertEqual(len(self.chamadas), 1, "a descoberta tem de ser memorizada")

    def test_a_falha_tambem_e_memorizada(self):
        """Sem isto, um provedor fora do ar faria cada tela de login esperar 5s."""
        self._responde(OSError("provedor fora do ar"))
        self.assertIsNone(sso.descobre("https://accounts.exemplo.com"))
        self.assertIsNone(sso.descobre("https://accounts.exemplo.com"))
        self.assertEqual(len(self.chamadas), 1)


class DesafioPkce(unittest.TestCase):
    def test_s256_bate_com_o_exemplo_da_especificacao(self):
        """Vetor do apêndice B da RFC 7636: se o cálculo mudar, o provedor recusa."""
        verificador = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        self.assertEqual(
            sso.desafio_de(verificador), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )

    def test_o_desafio_nao_leva_preenchimento(self):
        self.assertNotIn("=", sso.desafio_de(sso.novo_verificador()))


# --------------------------------------------------------------------------
# A carga do id_token, campo a campo
# --------------------------------------------------------------------------


class CargaDoIdToken(unittest.TestCase):
    EMISSOR = "https://accounts.exemplo.com"
    NONCE = "nonce-desta-ida"

    def carga(self, **troca):
        agora = 1_700_000_000
        base = {
            "iss": self.EMISSOR,
            "aud": CLIENT_ID,
            "exp": agora + 600,
            "iat": agora,
            "nonce": self.NONCE,
            "sub": "conta-123",
        }
        base.update(troca)
        return base

    def confere(self, carga, agora=1_700_000_000):
        """Devolve o motivo da recusa, ou "" quando a carga passa inteira."""
        config = sso.ConfiguracaoSSO(issuer=self.EMISSOR, client_id=CLIENT_ID)
        try:
            sso.confere_id_token(carga, config, self.NONCE, agora=agora)
        except sso.FalhaDeSSO as erro:
            return erro.detalhe
        return ""

    def test_a_carga_boa_passa(self):
        self.assertEqual(self.confere(self.carga()), "")

    def test_emissor_diferente(self):
        self.assertIn("iss", self.confere(self.carga(iss="https://impostor.exemplo.com")))

    def test_audiencia_de_outro_cliente(self):
        """Um token legítimo emitido para OUTRO serviço não vale aqui."""
        self.assertIn("aud", self.confere(self.carga(aud="outro-cliente")))

    def test_audiencia_em_lista_com_o_nosso_cliente_passa(self):
        carga = self.carga(aud=[CLIENT_ID, "outro"], azp=CLIENT_ID)
        self.assertEqual(self.confere(carga), "")

    def test_varias_audiencias_sem_azp_nosso_e_recusado(self):
        carga = self.carga(aud=[CLIENT_ID, "outro"], azp="outro")
        self.assertIn("azp", self.confere(carga))

    def test_token_expirado(self):
        self.assertIn("expirado", self.confere(self.carga(), agora=1_700_000_601))

    def test_emitido_fora_da_tolerancia_de_relogio(self):
        """Relógio do container fora de hora tem de dizer isso, e não 'senha errada'."""
        problema = self.confere(self.carga(iat=1_700_000_000 - 3600))
        self.assertIn("relógio", problema)

    def test_nonce_diferente_do_cookie(self):
        self.assertIn("nonce", self.confere(self.carga(nonce="nonce-de-outra-ida")))

    def test_sem_exp_nao_passa(self):
        carga = self.carga()
        del carga["exp"]
        self.assertIn("exp", self.confere(carga))

    def test_carga_ilegivel(self):
        """Corpo que não é um JWT não vira `None` silencioso: vira recusa."""
        for ruim in ("isto-nao-e-um-jwt", "a.b.c"):
            with self.assertRaises(sso.FalhaDeSSO):
                sso.decodifica_payload(ruim)


# --------------------------------------------------------------------------
# O cookie de ida e volta
# --------------------------------------------------------------------------


class CookieDeEstado(unittest.TestCase):
    def test_o_que_foi_gravado_volta_inteiro(self):
        valor = sessao.emitir_estado_sso("st", "no", "ve")
        self.assertEqual(
            sessao.ler_estado_sso(valor),
            {"state": "st", "nonce": "no", "verificador": "ve"},
        )

    def test_assinatura_adulterada_nao_passa(self):
        valor = sessao.emitir_estado_sso("st", "no", "ve")
        corpo, _, _assinatura = valor.rpartition(".")
        self.assertIsNone(sessao.ler_estado_sso(f"{corpo}.{'0' * 64}"))

    def test_carga_adulterada_nao_passa(self):
        outro = base64.urlsafe_b64encode(b"outro|no|ve|99999999999").decode("ascii")
        valor = sessao.emitir_estado_sso("st", "no", "ve")
        self.assertIsNone(sessao.ler_estado_sso(f"{outro}.{valor.rsplit('.', 1)[1]}"))

    def test_prazo_vencido_nao_passa(self):
        agora = time.time()
        valor = sessao.emitir_estado_sso("st", "no", "ve", agora=agora)
        self.assertIsNone(
            sessao.ler_estado_sso(
                valor, agora=agora + sessao.VALIDADE_DO_ESTADO_EM_SEGUNDOS + 1
            )
        )

    def test_um_cookie_nao_serve_de_outro(self):
        """Sem separar os domínios da assinatura, um estado forjado viraria sessão."""
        estado = sessao.emitir_estado_sso("st", "no", "ve")
        self.assertIsNone(sessao.usuario_da_sessao(estado))
        sessao_valida = sessao.emitir("admin")
        self.assertIsNone(sessao.ler_estado_sso(sessao_valida))

    def test_o_cookie_de_estado_nao_e_strict(self):
        """`Strict` não é enviado na volta do provedor: o login falharia em silêncio."""
        cabecalho = sessao.cabecalho_para_gravar_estado("x")
        self.assertIn("SameSite=Lax", cabecalho)
        self.assertIn("Path=/sso/", cabecalho)
        self.assertIn("HttpOnly", cabecalho)

    def test_apagar_repete_o_caminho(self):
        """Sem o mesmo `Path`, o navegador guarda o cookie que julgamos consumido."""
        self.assertIn("Path=/sso/", sessao.cabecalho_para_apagar_estado())
        self.assertIn("Max-Age=0", sessao.cabecalho_para_apagar_estado())


# --------------------------------------------------------------------------
# O fluxo inteiro contra um provedor falso
# --------------------------------------------------------------------------


class VoltaDoProvedor(unittest.TestCase):
    EMISSOR = "https://accounts.exemplo.com"

    def setUp(self):
        sso.limpa_cache_descoberta()
        # O `state` vale uma vez só por processo, e todos os testes desta classe
        # usam o mesmo: sem zerar, o segundo já chegaria como reapresentação.
        sso.esquece_estado_de_fluxo()
        self.pedir_de_verdade = sso._pedir
        self.agora = 1_700_000_000
        self.config = {
            "base_url": "https://painel.exemplo.com",
            "issuer": self.EMISSOR,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scopes": "openid email profile",
            "allowed_domains": "empresa.com",
            "allowed_emails": "",
        }
        self.estado = {"state": "st", "nonce": "no", "verificador": "ve"}
        self.parametros = {"state": "st", "code": "codigo-de-autorizacao"}
        self.carga = {
            "iss": self.EMISSOR,
            "aud": CLIENT_ID,
            "exp": self.agora + 600,
            "iat": self.agora,
            "nonce": "no",
            "sub": "conta-123",
        }
        self.perfil = {
            "sub": "conta-123",
            "email": "chefe@empresa.com",
            "email_verified": True,
        }
        self.pedidos = []
        sso._pedir = self.transporte

    def tearDown(self):
        sso._pedir = self.pedir_de_verdade
        sso.limpa_cache_descoberta()

    def transporte(self, url, dados=None, cabecalhos=None, timeout=None):
        # O corpo chega urlencodado em bytes, como o `token_endpoint` recebe.
        campos = urllib.parse.parse_qs((dados or b"").decode("utf-8"))
        self.pedidos.append({
            "url": url,
            "dados": {chave: valor[0] for chave, valor in campos.items()},
            "cabecalhos": cabecalhos,
        })
        if url.endswith("/.well-known/openid-configuration"):
            return {
                "issuer": self.EMISSOR,
                "authorization_endpoint": f"{self.EMISSOR}/auth",
                "token_endpoint": f"{self.EMISSOR}/token",
                "userinfo_endpoint": f"{self.EMISSOR}/userinfo",
            }
        if url.endswith("/token"):
            return {
                "id_token": monta_id_token(self.carga),
                "access_token": "token-de-acesso",
            }
        if url.endswith("/userinfo"):
            return self.perfil
        raise AssertionError(f"pedido inesperado: {url}")

    def conclui(self, **troca):
        argumentos = {
            "config": self.config,
            "estado": self.estado,
            "parametros": self.parametros,
            "agora": self.agora,
        }
        argumentos.update(troca)
        return sso.conclui_login(**argumentos)

    def test_caminho_feliz(self):
        email, motivo = self.conclui()
        self.assertEqual(motivo, "")
        self.assertEqual(email, "chefe@empresa.com")

    def test_sem_cookie_de_estado_e_recusado(self):
        """Aceitar sem cookie é aceitar um pedido de login forjado por terceiro."""
        email, motivo = self.conclui(estado=None)
        self.assertEqual(email, "")
        self.assertIn("cookie de estado", motivo)

    def test_state_trocado_e_recusado(self):
        email, motivo = self.conclui(
            parametros={"state": "state-do-atacante", "code": "c"}
        )
        self.assertEqual(email, "")
        self.assertIn("state", motivo)

    def test_erro_do_provedor_e_recusado(self):
        email, motivo = self.conclui(
            parametros={"state": "st", "error": "access_denied"}
        )
        self.assertEqual(email, "")

    def test_code_vazio_e_recusado(self):
        email, _ = self.conclui(parametros={"state": "st", "code": ""})
        self.assertEqual(email, "")

    def test_o_endereco_de_retorno_enviado_ao_provedor_sai_da_configuracao(self):
        """O `Host` da requisição nunca entra nesta conta -- quem chama o escolhe."""
        self.conclui()
        troca = [p for p in self.pedidos if p["url"].endswith("/token")][0]
        self.assertEqual(
            troca["dados"]["redirect_uri"], "https://painel.exemplo.com/sso/oidc/callback"
        )
        self.assertEqual(troca["dados"]["code_verifier"], "ve")
        self.assertEqual(troca["dados"]["grant_type"], "authorization_code")

    def test_id_token_expirado_e_recusado(self):
        self.carga["exp"] = self.agora - 1
        email, motivo = self.conclui()
        self.assertEqual(email, "")
        self.assertIn("expirado", motivo)

    def test_audiencia_errada_e_recusada(self):
        self.carga["aud"] = "outro-cliente"
        email, motivo = self.conclui()
        self.assertEqual(email, "")
        self.assertIn("aud", motivo)

    def test_nonce_de_outra_ida_e_recusado(self):
        self.carga["nonce"] = "nonce-de-outra-ida"
        email, motivo = self.conclui()
        self.assertEqual(email, "")
        self.assertIn("nonce", motivo)

    def test_sub_do_userinfo_diferente_e_recusado(self):
        """Ancorar o `sub` é o que liga o perfil lido ao token recebido."""
        self.perfil["sub"] = "outra-conta"
        email, motivo = self.conclui()
        self.assertEqual(email, "")
        self.assertIn("sub", motivo)

    def test_email_nao_confirmado_e_recusado(self):
        self.perfil["email_verified"] = False
        email, motivo = self.conclui()
        self.assertEqual(email, "")
        self.assertIn("verificado", motivo)

    def test_email_fora_da_lista_e_recusado(self):
        self.perfil["email"] = "estranho@gmail.com"
        email, motivo = self.conclui()
        self.assertEqual(email, "")
        self.assertIn("lista de permissão", motivo)

    def test_resposta_do_token_sem_access_token_e_recusada(self):
        def transporte(url, dados=None, cabecalhos=None, timeout=None):
            if url.endswith("/token"):
                return {"id_token": monta_id_token(self.carga)}
            return self.transporte(url, dados, cabecalhos, timeout)

        sso._pedir = transporte
        email, motivo = self.conclui()
        self.assertEqual(email, "")

    def test_o_cliente_se_autentica_na_troca(self):
        self.conclui()
        troca = [p for p in self.pedidos if p["url"].endswith("/token")][0]
        self.assertTrue(troca["cabecalhos"]["Authorization"].startswith("Basic "))

    def test_a_recusa_nao_conta_em_que_ponto_o_atacante_parou(self):
        """Detalhe vai para o log; a tela recebe sempre a mesma frase.

        Este teste mede o contrato: `conclui_login` devolve o motivo SEPARADO do
        e-mail, justamente para que quem responde na tela use uma frase só.
        """
        for troca in ({"estado": None}, {"parametros": {"state": "x", "code": "c"}}):
            email, motivo = self.conclui(**troca)
            self.assertEqual(email, "")
            self.assertTrue(motivo)


# --------------------------------------------------------------------------
# Um painel de pé, com um provedor de identidade de pé
# --------------------------------------------------------------------------


class ProvedorFalso(BaseHTTPRequestHandler):
    """Provedor de identidade mínimo, em loopback, para o painel conversar de verdade."""

    emissor = ""
    nonce = ""
    codigos_gastos = set()
    redirect_uris_recebidos = []

    def log_message(self, *a):
        pass

    def _json(self, corpo, status=200):
        dados = json.dumps(corpo).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        if self.path.startswith("/.well-known/openid-configuration"):
            base = type(self).emissor
            self._json({
                "issuer": base,
                "authorization_endpoint": f"{base}/auth",
                "token_endpoint": f"{base}/token",
                "userinfo_endpoint": f"{base}/userinfo",
            })
            return
        if self.path.startswith("/userinfo"):
            self._json({
                "sub": "conta-123",
                "email": "chefe@empresa.com",
                "email_verified": True,
            })
            return
        self.send_error(404)

    def do_POST(self):
        if not self.path.startswith("/token"):
            self.send_error(404)
            return
        tamanho = int(self.headers.get("Content-Length", 0))
        campos = urllib.parse.parse_qs(self.rfile.read(tamanho).decode("utf-8"))
        codigo = (campos.get("code") or [""])[0]
        type(self).redirect_uris_recebidos.append((campos.get("redirect_uri") or [""])[0])
        # O provedor invalida o código na primeira troca. É a defesa de quem
        # emite; a nossa é o cookie de uso único, testada logo abaixo.
        if codigo in type(self).codigos_gastos:
            self._json({"error": "invalid_grant"}, status=400)
            return
        type(self).codigos_gastos.add(codigo)
        agora = int(time.time())
        self._json({
            "access_token": "token-de-acesso",
            "id_token": monta_id_token({
                "iss": type(self).emissor,
                "aud": CLIENT_ID,
                "exp": agora + 600,
                "iat": agora,
                "nonce": type(self).nonce,
                "sub": "conta-123",
            }),
        })


class PainelDeVerdade(unittest.TestCase):
    """Painel e provedor de identidade de pé, conversando por HTTP no loopback."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.tmp.name, "data.sqlite")
        with sqlite3.connect(cls.db_path) as conn:
            conn.execute(
                "CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT, "
                "name TEXT, data TEXT, created_at TEXT, updated_at TEXT)"
            )
            conn.execute(
                "CREATE TABLE combos (id TEXT PRIMARY KEY, name TEXT, kind TEXT, "
                "models TEXT, created_at TEXT, updated_at TEXT)"
            )

        cls.porta_idp = porta_livre()
        ProvedorFalso.emissor = f"http://127.0.0.1:{cls.porta_idp}"
        cls.idp = ThreadingHTTPServer(("127.0.0.1", cls.porta_idp), ProvedorFalso)
        cls.idp.daemon_threads = True
        threading.Thread(target=cls.idp.serve_forever, daemon=True).start()

        cls.porta = porta_livre()
        # DATA_DIR vence o diretório do banco em `get_auth_file_path`: se a
        # variável estiver definida no ambiente de quem roda a suíte, o painel
        # gravaria a configuração em outro lugar e o teste mediria a coisa errada.
        cls._data_dir_anterior = os.environ.pop("DATA_DIR", None)
        cls.settings = Settings(
            db_path=cls.db_path,
            web_host="127.0.0.1",
            web_port=cls.porta,
            dashboard_user="admin",
            dashboard_password="SenhaLocal1!",
        )
        cls.base_url = f"http://127.0.0.1:{cls.porta}"
        cls.prefs = cls.settings.get_prefs_path()
        cls.base_dir = os.path.dirname(cls.settings.get_auth_file_path())

        cls.server = start_web_server(
            host="127.0.0.1",
            port=cls.porta,
            db_path=cls.db_path,
            settings=cls.settings,
        )

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.idp.shutdown()
        cls.idp.server_close()
        cls.tmp.cleanup()
        if cls._data_dir_anterior is not None:
            os.environ["DATA_DIR"] = cls._data_dir_anterior

    def setUp(self):
        # O teto por endereço é global ao processo, e cada teste faz várias
        # tentativas: sem zerar, o oitavo teste responderia 429 e mediria isso.
        protecao.limpa_apos_sucesso("127.0.0.1")
        sso.limpa_cache_descoberta()
        ProvedorFalso.codigos_gastos = set()
        ProvedorFalso.redirect_uris_recebidos = []
        os.environ.pop("SSO_DISABLED", None)
        os.environ.pop("OIDC_CLIENT_SECRET", None)

    # -- utilidades ------------------------------------------------------

    def liga_sso(self):
        sso.grava_configuracao(self.prefs, {
            "enabled": "oidc",
            "base_url": self.base_url,
            "issuer": ProvedorFalso.emissor,
            "client_id": CLIENT_ID,
            "scopes": "openid email profile",
            "allowed_domains": "empresa.com",
            "allowed_emails": "",
        })
        sso.grava_segredo(self.base_dir, CLIENT_SECRET)

    def desliga_sso(self):
        sso.grava_configuracao(self.prefs, {"enabled": ""})

    def pede(self, caminho, *, cabecalhos=None, metodo="GET", corpo=None):
        """Devolve (status, cabeçalhos, corpo).

        Os cabeçalhos saem como a mensagem HTTP crua, e não como dicionário: a
        resposta do callback traz DOIS `Set-Cookie` -- a sessão e o descarte do
        cookie de ida -- e um dicionário guardaria só o último, que é como um
        teste passa a medir a coisa errada.
        """
        conexao = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=5)
        try:
            conexao.request(metodo, caminho, body=corpo, headers=cabecalhos or {})
            resposta = conexao.getresponse()
            return resposta.status, resposta.headers, resposta.read().decode("utf-8")
        finally:
            conexao.close()

    @staticmethod
    def cookies(cabecalhos):
        return cabecalhos.get_all("Set-Cookie") or []

    def cookie_de_sessao(self, cabecalhos):
        """O cookie de sessão emitido na resposta, ou "" quando não houve nenhum."""
        for bruto in self.cookies(cabecalhos):
            if bruto.startswith(sessao.NOME_DO_COOKIE + "="):
                return bruto.split(";")[0]
        return ""

    def inicia_fluxo(self):
        """Faz a ida e devolve (cookie_de_estado, state)."""
        status, cabecalhos, _ = self.pede("/sso/oidc/iniciar")
        self.assertEqual(status, 302, "a ida ao provedor tem de ser um 302")
        cookie = self.cookies(cabecalhos)[0].split(";")[0]
        consulta = urllib.parse.parse_qs(
            urllib.parse.urlsplit(cabecalhos["Location"]).query
        )
        ProvedorFalso.nonce = consulta["nonce"][0]
        return cookie, consulta["state"][0]

    # -- sem configuração, nada muda -------------------------------------

    def test_sem_configuracao_as_rotas_nao_existem(self):
        """"Sem configuração, nada muda" tem de valer também para as rotas novas."""
        self.desliga_sso()
        for caminho in ("/sso/oidc/iniciar", "/sso/oidc/callback?code=x&state=y"):
            status, _, _ = self.pede(caminho)
            self.assertEqual(status, 404, caminho)

    def test_sem_configuracao_a_tela_de_login_e_a_de_hoje(self):
        self.desliga_sso()
        status, _, corpo = self.pede("/login", cabecalhos={"Accept": "text/html"})
        self.assertEqual(status, 200)
        self.assertNotIn("/sso/oidc/iniciar", corpo)
        self.assertIn('name="senha"', corpo, "o formulário local não pode sair da tela")

    def test_com_configuracao_o_botao_aparece_ao_lado_do_formulario(self):
        self.liga_sso()
        status, _, corpo = self.pede("/login", cabecalhos={"Accept": "text/html"})
        self.assertEqual(status, 200)
        self.assertIn('href="/sso/oidc/iniciar"', corpo)
        self.assertIn('name="senha"', corpo, "o formulário local nunca sai da tela")
        self.assertNotIn(
            "<form", corpo.split('href="/sso/oidc/iniciar"')[1][:200],
            "o botão do SSO é um link: `form-action 'self'` bloquearia um formulário",
        )

    def test_o_interruptor_de_emergencia_vence_o_banco(self):
        """É o que devolve o painel quando o provedor cai e ninguém entra."""
        self.liga_sso()
        os.environ["SSO_DISABLED"] = "1"
        try:
            status, _, _ = self.pede("/sso/oidc/iniciar")
            self.assertEqual(status, 404)
            _, _, corpo = self.pede("/login", cabecalhos={"Accept": "text/html"})
            self.assertNotIn("/sso/oidc/iniciar", corpo)
            self.assertIn('name="senha"', corpo)
        finally:
            os.environ.pop("SSO_DISABLED", None)

    # -- a ida -----------------------------------------------------------

    def test_a_ida_leva_pkce_s256_e_o_endereco_de_retorno_da_configuracao(self):
        self.liga_sso()
        status, cabecalhos, _ = self.pede("/sso/oidc/iniciar")
        self.assertEqual(status, 302)
        consulta = urllib.parse.parse_qs(
            urllib.parse.urlsplit(cabecalhos["Location"]).query
        )
        self.assertEqual(consulta["code_challenge_method"], ["S256"])
        self.assertEqual(
            consulta["redirect_uri"], [f"{self.base_url}/sso/oidc/callback"]
        )
        self.assertEqual(consulta["client_id"], [CLIENT_ID])
        self.assertIn("state", consulta)
        self.assertIn("nonce", consulta)
        self.assertIn("SameSite=Lax", cabecalhos["Set-Cookie"])

    def test_o_cookie_de_ida_nao_carrega_o_verificador_em_claro(self):
        """O verificador viaja assinado; em claro, o cookie viraria o próprio PKCE."""
        self.liga_sso()
        _, cabecalhos, _ = self.pede("/sso/oidc/iniciar")
        consulta = urllib.parse.parse_qs(
            urllib.parse.urlsplit(cabecalhos["Location"]).query
        )
        self.assertNotIn(consulta["code_challenge"][0], cabecalhos["Set-Cookie"])

    # -- a volta ---------------------------------------------------------

    def test_a_volta_boa_emite_a_mesma_sessao_do_formulario(self):
        self.liga_sso()
        cookie, state = self.inicia_fluxo()
        status, cabecalhos, corpo = self.pede(
            f"/sso/oidc/callback?code=codigo-1&state={state}",
            cabecalhos={"Cookie": cookie},
        )
        self.assertEqual(status, 200, "a volta responde 200, nunca 302")
        self.assertIn('http-equiv="refresh"', corpo)
        self.assertIn('content="0;url=/"', corpo)

        emitido = self.cookie_de_sessao(cabecalhos)
        self.assertTrue(emitido, "o callback tem de emitir o cookie de sessão")
        valor = emitido.split("=", 1)[1]
        # A MESMA sessão do formulário local, com o prefixo que diz por onde ela
        # entrou -- não uma segunda espécie de sessão.
        self.assertEqual(sessao.usuario_da_sessao(valor), "sso:chefe@empresa.com")
        self.assertIn("HttpOnly", " ".join(self.cookies(cabecalhos)))

    def test_a_sessao_emitida_abre_o_painel(self):
        self.liga_sso()
        cookie, state = self.inicia_fluxo()
        _, cabecalhos, _ = self.pede(
            f"/sso/oidc/callback?code=codigo-2&state={state}",
            cabecalhos={"Cookie": cookie},
        )
        sessao_cookie = self.cookie_de_sessao(cabecalhos)
        self.assertTrue(sessao_cookie)
        status, _, corpo = self.pede(
            "/", cabecalhos={"Cookie": sessao_cookie, "Accept": "text/html"}
        )
        self.assertEqual(status, 200)
        self.assertIn("9RTKSync", corpo)

    def test_state_trocado_na_volta_e_recusado(self):
        """É o pedido de login forjado: a vítima entraria na conta do atacante."""
        self.liga_sso()
        cookie, _ = self.inicia_fluxo()
        status, _, corpo = self.pede(
            "/sso/oidc/callback?code=codigo-3&state=state-do-atacante",
            cabecalhos={"Cookie": cookie, "Accept": "text/html"},
        )
        self.assertEqual(status, 200)
        self.assertIn('name="senha"', corpo, "a recusa volta para o formulário local")
        self.assertNotIn(sessao.NOME_DO_COOKIE + "=ey", corpo)

    def test_volta_sem_cookie_de_ida_e_recusada(self):
        self.liga_sso()
        _, state = self.inicia_fluxo()
        status, cabecalhos, _ = self.pede(
            f"/sso/oidc/callback?code=codigo-4&state={state}",
            cabecalhos={"Accept": "text/html"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.cookie_de_sessao(cabecalhos), "")

    def test_o_mesmo_code_reapresentado_nao_cria_segunda_sessao(self):
        """O código fica na barra de endereços e no histórico: reapresentá-lo é barato."""
        self.liga_sso()
        cookie, state = self.inicia_fluxo()
        alvo = f"/sso/oidc/callback?code=codigo-repetido&state={state}"
        status, _, _ = self.pede(alvo, cabecalhos={"Cookie": cookie})
        self.assertEqual(status, 200)

        # Segunda volta, mesmo code e mesmo cookie: o provedor já gastou o
        # código, e a resposta é a recusa genérica.
        status, cabecalhos, corpo = self.pede(
            alvo, cabecalhos={"Cookie": cookie, "Accept": "text/html"}
        )
        self.assertEqual(status, 200)
        self.assertIn('name="senha"', corpo)
        self.assertEqual(self.cookie_de_sessao(cabecalhos), "")

    def test_a_recusa_apaga_o_cookie_de_ida(self):
        """Uso único: uma segunda volta não pode encontrar com que comparar."""
        self.liga_sso()
        cookie, _ = self.inicia_fluxo()
        _, cabecalhos, _ = self.pede(
            "/sso/oidc/callback?code=c&state=errado",
            cabecalhos={"Cookie": cookie, "Accept": "text/html"},
        )
        self.assertIn(
            sessao.NOME_DO_COOKIE_DE_ESTADO + "=;", " ".join(self.cookies(cabecalhos))
        )

    def test_o_cabecalho_host_hostil_nao_muda_o_endereco_de_retorno(self):
        """`Host` é escolhido por quem chama: derivar a URL dali é o redirecionamento aberto."""
        self.liga_sso()
        cookie, state = self.inicia_fluxo()
        self.pede(
            f"/sso/oidc/callback?code=codigo-5&state={state}",
            cabecalhos={"Cookie": cookie, "Host": "painel-do-atacante.exemplo.com"},
        )
        self.assertEqual(
            ProvedorFalso.redirect_uris_recebidos,
            [f"{self.base_url}/sso/oidc/callback"],
        )

    def test_o_destino_do_pouso_e_sempre_a_raiz(self):
        """Nenhum parâmetro da volta vira destino, ou isso vira redirecionamento aberto."""
        self.liga_sso()
        cookie, state = self.inicia_fluxo()
        _, _, corpo = self.pede(
            f"/sso/oidc/callback?code=codigo-6&state={state}&next=https://exemplo.com",
            cabecalhos={"Cookie": cookie},
        )
        self.assertIn('content="0;url=/"', corpo)
        self.assertNotIn("exemplo.com", corpo)

    # -- quem pode mexer na configuração ---------------------------------

    def test_salvar_a_configuracao_exige_a_senha_local(self):
        """Sessão sozinha não basta: um cookie roubado apontaria o painel a um IdP hostil."""
        self.liga_sso()
        cookie = f"{sessao.NOME_DO_COOKIE}={sessao.emitir('admin')}"
        corpo = urllib.parse.urlencode({
            "enabled": "oidc",
            "base_url": self.base_url,
            "issuer": ProvedorFalso.emissor,
            "client_id": "cliente-do-atacante",
            "allowed_domains": "atacante.com",
            "senha_atual": "senha-errada",
        })
        status, cabecalhos, _ = self.pede(
            "/acoes/sso",
            metodo="POST",
            corpo=corpo,
            cabecalhos={
                "Cookie": cookie,
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": str(len(corpo)),
                "Origin": f"http://127.0.0.1:{self.porta}",
            },
        )
        self.assertEqual(status, 303)
        self.assertIn("tom=danger", cabecalhos["Location"])
        # E a configuração continua a que estava.
        self.assertEqual(sso.ler_configuracao(self.prefs)["client_id"], CLIENT_ID)

    def test_salvar_sem_sessao_nao_passa(self):
        corpo = urllib.parse.urlencode({"enabled": "", "senha_atual": "SenhaLocal1!"})
        status, _, _ = self.pede(
            "/acoes/sso",
            metodo="POST",
            corpo=corpo,
            cabecalhos={
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": str(len(corpo)),
                "Accept": "text/html",
            },
        )
        self.assertEqual(status, 302, "sem sessão, a ação manda para o formulário")

    def test_o_segredo_gravado_nunca_volta_para_a_tela(self):
        """Um GET de configuração jamais devolve o valor: só que existe um."""
        self.liga_sso()
        cookie = f"{sessao.NOME_DO_COOKIE}={sessao.emitir('admin')}"
        status, _, corpo = self.pede(
            "/", cabecalhos={"Cookie": cookie, "Accept": "text/html"}
        )
        self.assertEqual(status, 200)
        self.assertNotIn(CLIENT_SECRET, corpo)
        self.assertIn("modalSSO", corpo)

    def test_o_arquivo_do_segredo_e_0600(self):
        self.liga_sso()
        modo = os.stat(sso.caminho_do_segredo(self.base_dir)).st_mode & 0o777
        self.assertEqual(modo, 0o600, "o segredo do cliente é legível só pelo dono")

    def test_o_ambiente_vence_o_arquivo(self):
        self.liga_sso()
        os.environ["OIDC_CLIENT_SECRET"] = "segredo-do-ambiente"
        try:
            self.assertEqual(sso.ler_segredo(self.base_dir), "segredo-do-ambiente")
            self.assertTrue(sso.segredo_vem_do_ambiente())
        finally:
            os.environ.pop("OIDC_CLIENT_SECRET", None)

    def test_campo_de_segredo_em_branco_mantem_o_que_esta_gravado(self):
        """Reabrir a tela para corrigir a lista não pode desligar o SSO em silêncio."""
        self.liga_sso()
        cookie = f"{sessao.NOME_DO_COOKIE}={sessao.emitir('admin')}"
        corpo = urllib.parse.urlencode({
            "enabled": "oidc",
            "base_url": self.base_url,
            "issuer": ProvedorFalso.emissor,
            "client_id": CLIENT_ID,
            "scopes": "openid email profile",
            "allowed_domains": "empresa.com,filial.com",
            "allowed_emails": "",
            "client_secret": "",
            "senha_atual": "SenhaLocal1!",
        })
        status, cabecalhos, _ = self.pede(
            "/acoes/sso",
            metodo="POST",
            corpo=corpo,
            cabecalhos={
                "Cookie": cookie,
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": str(len(corpo)),
                "Origin": f"http://127.0.0.1:{self.porta}",
            },
        )
        self.assertEqual(status, 303)
        self.assertIn("tom=success", cabecalhos["Location"])
        self.assertEqual(sso.ler_segredo(self.base_dir), CLIENT_SECRET)
        self.assertEqual(
            sso.ler_configuracao(self.prefs)["allowed_domains"], "empresa.com,filial.com"
        )

    def test_ligar_sem_lista_de_permissao_e_recusado(self):
        self.liga_sso()
        cookie = f"{sessao.NOME_DO_COOKIE}={sessao.emitir('admin')}"
        corpo = urllib.parse.urlencode({
            "enabled": "oidc",
            "base_url": self.base_url,
            "issuer": ProvedorFalso.emissor,
            "client_id": CLIENT_ID,
            "allowed_domains": "",
            "allowed_emails": "",
            "senha_atual": "SenhaLocal1!",
        })
        _, cabecalhos, _ = self.pede(
            "/acoes/sso",
            metodo="POST",
            corpo=corpo,
            cabecalhos={
                "Cookie": cookie,
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": str(len(corpo)),
                "Origin": f"http://127.0.0.1:{self.porta}",
            },
        )
        self.assertIn("tom=danger", cabecalhos["Location"])
        self.assertEqual(
            sso.ler_configuracao(self.prefs)["allowed_domains"], "empresa.com",
            "a configuração anterior continua de pé",
        )


# --------------------------------------------------------------------------
# SAML2: o que é NOSSO no protocolo
# --------------------------------------------------------------------------
#
# A validação da asserção (assinatura XML, `Audience`, `NotOnOrAfter`, defesa
# contra XML Signature Wrapping) é da `python3-saml`, que NÃO está instalada
# nesta imagem -- por isso o teste que dependeria dela pula em vez de
# reprovar. O que é nosso, e está testado aqui: o conjunto de pendentes que
# dá sentido ao `InResponseTo`, o cache de repetição da asserção, a
# AuthnRequest montada a partir de `sso.base_url` e o dicionário de
# configuração que tira da biblioteca o direito de montar o endereço do ACS
# a partir do cabeçalho `Host`.


class PendentesDoSaml(unittest.TestCase):
    """O conjunto de pendentes é o que dá sentido ao `InResponseTo`."""

    def setUp(self):
        sso.esquece_estado_de_fluxo()

    def test_o_que_foi_registrado_e_consumido_uma_vez_so(self):
        sso.registra_pendente("_abc")
        self.assertTrue(sso.consome_pendente("_abc"))
        self.assertFalse(sso.consome_pendente("_abc"))

    def test_id_que_ninguem_registrou_nao_passa(self):
        self.assertFalse(sso.consome_pendente("_inventado"))

    def test_pendente_fora_do_prazo_nao_passa(self):
        sso.registra_pendente("_velho", agora=1000)
        self.assertFalse(
            sso.consome_pendente("_velho", agora=1000 + sso.VALIDADE_DO_PENDENTE + 1)
        )

    def test_o_conjunto_tem_teto_e_descarta_o_mais_antigo(self):
        """A rota é pública: sem teto, ela vira consumo de memória ilimitado."""
        for numero in range(sso.LIMITE_DE_PENDENTES + 10):
            sso.registra_pendente(f"_{numero}", agora=1000 + numero)
        self.assertLessEqual(len(sso._pendentes), sso.LIMITE_DE_PENDENTES)
        self.assertFalse(sso.consome_pendente("_0", agora=1000))

    def test_a_mesma_assercao_nao_vale_duas_vezes(self):
        self.assertFalse(sso.assercao_ja_usada("id-da-assercao"))
        self.assertTrue(sso.assercao_ja_usada("id-da-assercao"))

    def test_resposta_sem_in_response_to_e_recusada(self):
        """Fluxo iniciado pelo IdP é o vetor clássico de CSRF de login."""
        xml = b'<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"/>'
        with self.assertRaises(sso.FalhaDeSSO):
            sso.in_response_to(base64.b64encode(xml).decode())

    def test_o_in_response_to_e_lido_da_resposta(self):
        xml = b'<samlp:Response InResponseTo="_pendente-1"/>'
        self.assertEqual(sso.in_response_to(base64.b64encode(xml).decode()), "_pendente-1")


class EnderecosDoSaml(unittest.TestCase):
    """Tudo sai de `sso.base_url`, e nada do cabeçalho `Host`."""

    def setUp(self):
        self.config = sso.ConfiguracaoSSO(
            provedor="saml", base_url="https://painel.exemplo.com",
            idp_entity_id="https://idp.exemplo.com/metadata",
            idp_sso_url="https://idp.exemplo.com/sso",
            idp_cert="MIIC-de-mentira", dominios=("empresa.com",),
        )

    def test_a_authn_request_aponta_para_o_acs_da_configuracao(self):
        xml = sso.monta_authn_request(self.config, "_id", agora=1_700_000_000)
        self.assertIn('AssertionConsumerServiceURL="https://painel.exemplo.com/sso/saml/acs"', xml)
        self.assertIn('Destination="https://idp.exemplo.com/sso"', xml)
        self.assertIn("<saml:Issuer>https://painel.exemplo.com/sso/saml/metadata</saml:Issuer>", xml)

    def test_o_binding_de_ida_e_por_redirecionamento(self):
        """HTTP-POST binding bateria na CSP `form-action 'self'` e seria bloqueado."""
        xml = sso.monta_authn_request(self.config, "_id", agora=1_700_000_000)
        destino = sso.url_de_ida_saml(self.config, xml)
        self.assertTrue(destino.startswith("https://idp.exemplo.com/sso?SAMLRequest="))
        parametro = urllib.parse.parse_qs(urllib.parse.urlsplit(destino).query)["SAMLRequest"][0]
        recuperado = zlib.decompress(base64.b64decode(parametro), -zlib.MAX_WBITS).decode("utf-8")
        self.assertEqual(recuperado, xml)

    def test_a_biblioteca_recebe_o_destino_da_configuracao_e_nao_da_requisicao(self):
        """O default da `python3-saml` monta a URL do ACS a partir do `http_host`."""
        ajustes = sso.configuracao_da_biblioteca(self.config)
        self.assertTrue(ajustes["strict"])
        self.assertTrue(ajustes["security"]["wantAssertionsSigned"])
        self.assertTrue(ajustes["security"]["wantMessagesSigned"])
        self.assertTrue(ajustes["security"]["rejectUnsolicitedResponsesWithInResponseTo"])
        self.assertEqual(
            ajustes["sp"]["assertionConsumerService"]["url"],
            "https://painel.exemplo.com/sso/saml/acs",
        )
        dados = sso.dados_da_requisicao(self.config, {"SAMLResponse": "x"})
        self.assertEqual(dados["http_host"], "painel.exemplo.com")
        self.assertEqual(dados["https"], "on")

    def test_a_porta_viaja_dentro_do_host_e_nao_num_campo_proprio(self):
        """O campo separado, vazio, montava "https://host:/sso/saml/acs".

        Com dois-pontos e sem número — e a biblioteca recusava a própria
        asserção correta dizendo que o destino não batia. Encontrado na bancada,
        com asserção assinada de verdade; preso aqui para que o defeito não
        volte numa máquina onde a biblioteca nem está instalada.
        """
        com_porta = sso.ConfiguracaoSSO(base_url="http://127.0.0.1:9093")
        dados = sso.dados_da_requisicao(com_porta, {})
        self.assertEqual(dados["http_host"], "127.0.0.1:9093")
        self.assertEqual(dados["https"], "off")
        self.assertNotIn("server_port", dados)

    def test_sem_a_biblioteca_o_painel_recusa_em_vez_de_quebrar(self):
        if sso.saml_disponivel():
            self.skipTest("a biblioteca está instalada nesta máquina")
        with self.assertRaises(sso.FalhaDeSSO):
            sso.processa_resposta_saml(self.config, "qualquer-coisa", "_id")

class SamlNoModuloEAindaSemRota(unittest.TestCase):
    """O SAML2 já está escrito aqui; falta a rota que o expõe.

    A biblioteca que confere a assinatura XML não está nesta imagem, e a aba da
    tela continua dizendo isso. O que mudou é que o módulo não finge mais: o
    fluxo inteiro existe e é o MESMO texto dos irmãos.
    """

    def test_a_deteccao_da_biblioteca_nao_explode(self):
        """`saml_disponivel` decide qual das duas frases a aba exibe, e nada mais.

        Ela NÃO é uma asserção sobre o ambiente: instalar `python3-saml` é
        exatamente o primeiro passo da próxima fase, e um teste que ficasse
        vermelho nesse momento reprovaria a suíte por um motivo que o código não
        causou.
        """
        self.assertIsInstance(sso.saml_disponivel(), bool)

    def test_a_aba_saml_diz_por_que_esta_desabilitada(self):
        from nine_rtksync.render import render_sso_modal

        modal = render_sso_modal({"saml_disponivel": sso.saml_disponivel()}, "pt")
        self.assertIn("SAML 2.0", modal)
        # Campos desenhados e traduzidos, mas travados: nada de aceitar uma
        # configuração que o painel não sabe usar.
        self.assertIn("sso_saml_idp_cert", modal)
        self.assertIn("disabled", modal)

    def test_as_tres_rotas_de_saml_existem(self):
        """O que era estado intermediário virou o estado final.

        Este teste já afirmou o contrário -- que NÃO havia rota de SAML aqui --
        e estava certo enquanto o `web.py` não tinha as portas: rota que existe
        e sempre recusa é pior que rota que não existe. As três portas existem
        agora nos três painéis, então a afirmação se inverte.

        A TELA ainda não oferece o provedor neste painel: `ler_configuracao`
        não lê os campos do IdP, e a camada que a tela usa é a que ainda não
        convergiu com a do LiteLlmRTKSync. O núcleo e as rotas, sim.
        """
        fonte = (
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            + "/src/nine_rtksync/web.py"
        )
        with open(fonte, encoding="utf-8") as f:
            texto = f.read()
        for rota in ("/sso/saml/iniciar", "/sso/saml/acs", "/sso/saml/metadata"):
            self.assertIn(
                rota, texto,
                f"{rota} sumiu: o módulo tem a federação inteira e o painel "
                f"ficaria de novo com código sem porta",
            )


class NovosRecursosDeSSO(unittest.TestCase):
    """Testa conexão OIDC/SAML, modo simultâneo (both), salvaguarda anti-lockout e desativação de senha."""

    def test_teste_de_conexao_oidc_sem_emissor(self):
        ok, msg = sso.testar_conexao_oidc("")
        self.assertFalse(ok)
        self.assertIn("emissor", msg.lower())

    def test_teste_de_conexao_oidc_esquema_invalido(self):
        ok, msg = sso.testar_conexao_oidc("ftp://exemplo.com")
        self.assertFalse(ok)

    def test_teste_de_conexao_saml_faltando_campos(self):
        ok, msg = sso.testar_conexao_saml("", "", "")
        self.assertFalse(ok)

    def test_teste_de_conexao_saml_certificado_curto_recusado(self):
        ok, msg = sso.testar_conexao_saml("https://idp.com", "http://127.0.0.1:5000/sso", "curto", "http://127.0.0.1:8080")
        self.assertFalse(ok)
        self.assertIn("truncado", msg.lower())

    def test_teste_de_conexao_saml_sucesso(self):
        cert = base64.b64encode(b"A" * 64).decode()
        ok, msg = sso.testar_conexao_saml("https://idp.com", "http://127.0.0.1:5000/sso", cert, "http://127.0.0.1:8080")
        if not sso.saml_disponivel():
            self.assertFalse(ok)
            self.assertIn("instalada", msg.lower())
        else:
            self.assertTrue(ok)
            self.assertIn("validados com sucesso", msg.lower())

    def test_anti_lockout_impede_desativar_todas_as_formas(self):
        cfg = sso.ConfiguracaoSSO(provedor="", oidc_habilitado=False, saml_habilitado=False, senha_habilitada=False)
        self.assertTrue(cfg.senha_esta_ligada())

    def test_provedor_both_ativa_ambos_e_exibe_botoes(self):
        cert = base64.b64encode(b"A" * 64).decode()
        cfg = sso.ConfiguracaoSSO(
            provedor="both", oidc_habilitado=True, saml_habilitado=True, senha_habilitada=True,
            base_url="http://127.0.0.1:8080", issuer="http://127.0.0.1:5000", client_id="c",
            idp_entity_id="idp", idp_sso_url="http://127.0.0.1:5000/sso", idp_cert=cert,
            dominios=("empresa.com",), tem_segredo=True,
        )
        self.assertTrue(cfg.oidc_esta_ligado())
        if sso.saml_disponivel():
            self.assertTrue(cfg.saml_esta_ligado())
        else:
            self.assertFalse(cfg.saml_esta_ligado())
        self.assertTrue(cfg.senha_esta_ligada())


if __name__ == "__main__":
    unittest.main()

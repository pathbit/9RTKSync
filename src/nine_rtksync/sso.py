"""SSO do painel: entrada federada por OIDC, ao lado do formulário local.

O painel continua com as duas portas de sempre — sessão para o navegador, Basic
Auth para `curl` e monitoramento. O SSO acrescenta uma TERCEIRA forma de nascer
uma sessão, e só isso: o cookie emitido no fim do fluxo é exatamente o mesmo que
o formulário emite hoje (`sessao.emitir`). Não existe segunda espécie de sessão.

Três gavetas, separadas por sensibilidade:

1. **O que não é segredo** vai para o SQLite de preferências, com o prefixo
   `sso.` — emissor, identificador do cliente, lista de quem pode entrar.
2. **O segredo do cliente** NUNCA vai para o banco. Ele mora num arquivo com
   modo 0600, ao lado da credencial de recuperação, pelo mesmo molde de
   `auth.ensure_recovery_hash`. Cifrar no banco seria teatro: a chave da cifra
   ficaria no mesmo volume, e o modelo de ataque seria idêntico ao do arquivo
   0600 puro, com o custo de uma cifra artesanal.
3. **O ambiente vence**: `OIDC_CLIENT_SECRET` tem precedência sobre o arquivo, e
   quando ele está definido a tela trava o campo, como já acontece com
   `DASHBOARD_PASSWORD`.

Sem configuração completa, nada muda: a tela de login é a de hoje e as rotas
`/sso/*` recusam. `SSO_DISABLED=1` no ambiente vence o banco e é o interruptor
de emergência para quando o provedor de identidade cai.

A assinatura do `id_token` NÃO é verificada localmente, e isso é decisão, não
atalho: o token chega pelo canal direto entre este processo e o
`token_endpoint`, sobre TLS com certificado verificado e com o cliente
autenticado — o caso que a OIDC Core 3.1.3.7, item 6, dispensa da verificação.
A alternativa exigiria RSA, que a biblioteca padrão não tem, e escrever
verificação de preenchimento PKCS#1 à mão é exatamente onde essas
implementações falham em silêncio. Em troca, o `userinfo_endpoint` é sempre
consultado: apresentar o `access_token` prova que a troca do código foi real e
ancora o `sub`.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
from typing import Callable, Dict, List, Optional, Tuple

from .prefs import get_preference, set_preference

_log = logging.getLogger(__name__)

# --- Chaves de preferência (nada aqui é segredo) ----------------------------
CHAVE_ENABLED = "sso.enabled"
CHAVE_BASE_URL = "sso.base_url"
CHAVE_OIDC_ISSUER = "sso.oidc.issuer"
CHAVE_OIDC_CLIENT_ID = "sso.oidc.client_id"
CHAVE_OIDC_SCOPES = "sso.oidc.scopes"
CHAVE_SAML_ENTITY_ID = "sso.saml.idp_entity_id"
CHAVE_SAML_SSO_URL = "sso.saml.idp_sso_url"
CHAVE_SAML_CERT = "sso.saml.idp_cert"
CHAVE_ALLOWED_DOMAINS = "sso.allowed_domains"
CHAVE_ALLOWED_EMAILS = "sso.allowed_emails"
CHAVE_UPDATED_AT = "sso.updated_at"

# Um provedor por vez, nunca os dois ligados: com um único emissor legítimo a
# comparar, o ataque de confusão entre provedores deixa de existir, e sobra uma
# só lista de permissão para o operador manter.
PROVEDORES = ("", "oidc")

SCOPES_PADRAO = "openid email profile"

# O arquivo do segredo, ao lado da credencial de recuperação e com o mesmo modo.
SECRET_FILE_NAME = ".sso_client_secret"

# Caminhos das rotas. Escritos uma vez, porque o redirecionamento registrado no
# provedor tem de bater caractere a caractere com o que enviamos.
ROTA_INICIAR = "/sso/oidc/iniciar"
ROTA_CALLBACK = "/sso/oidc/callback"

TIMEOUT_DESCOBERTA = 5.0
TIMEOUT_TOKEN = 10.0
TTL_DESCOBERTA = 3600.0

# A FALHA também é memorizada, por um minuto. A tela de login pergunta ao
# emissor para saber se desenha o botão; sem guardar a falha, um provedor fora
# do ar faria cada carregamento da tela esperar cinco segundos — a página que
# tem de continuar funcionando quando o provedor cai seria a primeira a parar.
TTL_DESCOBERTA_FALHA = 60.0

# Tolerância de relógio do `iat`. Container com relógio fora de hora derruba o
# login inteiro, e o sintoma parece "SSO quebrado" em vez de "hora errada".
TOLERANCIA_DE_RELOGIO = 300


def _verdadeiro(valor: str) -> bool:
    return str(valor or "").strip().lower() in ("1", "true", "yes", "on")


# --- Interruptor de emergência ----------------------------------------------


def desligado_por_ambiente() -> bool:
    """`SSO_DISABLED=1` vence o banco, sem precisar tocar no SQLite.

    É o que salva quando o provedor caiu e o painel está atrás de um túnel: subir
    o container com a variável devolve a tela de login local imediatamente.
    """
    return _verdadeiro(os.environ.get("SSO_DISABLED", ""))


# --- O segredo do cliente ---------------------------------------------------


def caminho_do_segredo(base_dir: str) -> str:
    return os.path.join(base_dir or ".", SECRET_FILE_NAME)


def segredo_vem_do_ambiente() -> bool:
    return bool(os.environ.get("OIDC_CLIENT_SECRET", "").strip())


def ler_segredo(base_dir: str) -> str:
    """Ambiente primeiro, depois o arquivo 0600. Sem nenhum dos dois, vazio.

    Mesma ordem de `auth.resolve_recovery_hash`: quem opera por variável de
    ambiente não quer que um arquivo esquecido no volume passe na frente.
    """
    do_ambiente = os.environ.get("OIDC_CLIENT_SECRET", "").strip()
    if do_ambiente:
        return do_ambiente

    caminho = caminho_do_segredo(base_dir)
    if caminho and os.path.exists(caminho):
        try:
            with open(caminho, "r", encoding="utf-8") as f:
                return f.read().strip()
        except OSError:
            # Sem permissão de leitura equivale a "não há segredo": o SSO fica
            # desligado, e não ligado sem segredo.
            return ""
    return ""


def grava_segredo(base_dir: str, valor: str) -> bool:
    """Grava o segredo com modo 0600. Devolve False quando o disco não permite.

    Sem disco gravável o SSO NÃO liga — é diferente de ligar silenciosamente sem
    segredo, que daria um botão na tela de login levando a uma falha genérica.
    """
    caminho = caminho_do_segredo(base_dir)
    if not caminho:
        return False
    try:
        os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
        # 0600: só o dono do processo lê o segredo do cliente.
        fd = os.open(caminho, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(str(valor or "").strip())
        return True
    except OSError:
        return False


# --- Leitura e validação da configuração ------------------------------------


def lista_de(texto: str) -> List[str]:
    """Quebra uma lista separada por vírgula, sem itens vazios e em caixa baixa."""
    return [p.strip().lower() for p in str(texto or "").split(",") if p.strip()]


def base_url_valida(url: str) -> bool:
    """Origem pública EXATA: esquema e host, sem caminho, sem consulta.

    Fora do loopback só `https`. O redirecionamento registrado no provedor sai
    daqui, nunca do cabeçalho `Host` — deriva-lo do `Host`, que é escolhido pelo
    cliente, é a definição de redirecionamento aberto.
    """
    if not url:
        return False
    partes = urllib.parse.urlsplit(str(url).strip())
    if partes.scheme not in ("http", "https"):
        return False
    if not partes.netloc:
        return False
    if partes.path not in ("", "/") or partes.query or partes.fragment:
        return False
    if partes.scheme == "http" and not _e_loopback(partes.hostname or ""):
        return False
    return True


def _e_loopback(host: str) -> bool:
    return host in ("localhost", "127.0.0.1", "::1", "[::1]")


def url_segura(url: str) -> bool:
    """Aceita `https` em qualquer lugar e `http` apenas no loopback."""
    partes = urllib.parse.urlsplit(str(url or ""))
    if partes.scheme == "https":
        return True
    return partes.scheme == "http" and _e_loopback(partes.hostname or "")


def normaliza_base_url(url: str) -> str:
    return str(url or "").strip().rstrip("/")


def ler_configuracao(prefs_path: str) -> Dict[str, str]:
    """Tudo o que a tela precisa mostrar. NUNCA inclui o segredo do cliente."""
    return {
        "enabled": (get_preference(prefs_path, CHAVE_ENABLED, "") or "").strip(),
        "base_url": (get_preference(prefs_path, CHAVE_BASE_URL, "") or "").strip(),
        "issuer": (get_preference(prefs_path, CHAVE_OIDC_ISSUER, "") or "").strip(),
        "client_id": (get_preference(prefs_path, CHAVE_OIDC_CLIENT_ID, "") or "").strip(),
        "scopes": (get_preference(prefs_path, CHAVE_OIDC_SCOPES, "") or "").strip()
        or SCOPES_PADRAO,
        "allowed_domains": (get_preference(prefs_path, CHAVE_ALLOWED_DOMAINS, "") or "").strip(),
        "allowed_emails": (get_preference(prefs_path, CHAVE_ALLOWED_EMAILS, "") or "").strip(),
        "updated_at": (get_preference(prefs_path, CHAVE_UPDATED_AT, "") or "").strip(),
    }


def grava_configuracao(prefs_path: str, campos: Dict[str, str]) -> bool:
    """Grava a configuração não sensível. O segredo tem caminho próprio."""
    pares = (
        (CHAVE_ENABLED, campos.get("enabled", "")),
        (CHAVE_BASE_URL, normaliza_base_url(campos.get("base_url", ""))),
        (CHAVE_OIDC_ISSUER, normaliza_base_url(campos.get("issuer", ""))),
        (CHAVE_OIDC_CLIENT_ID, campos.get("client_id", "")),
        (CHAVE_OIDC_SCOPES, campos.get("scopes", "") or SCOPES_PADRAO),
        (CHAVE_ALLOWED_DOMAINS, campos.get("allowed_domains", "")),
        (CHAVE_ALLOWED_EMAILS, campos.get("allowed_emails", "")),
        (CHAVE_UPDATED_AT, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
    )
    return all(set_preference(prefs_path, chave, str(valor or "")) for chave, valor in pares)


def problemas_da_configuracao(campos: Dict[str, str], tem_segredo: bool) -> List[str]:
    """Chaves de tradução do que impede LIGAR o SSO. Lista vazia é aceite.

    A lista de permissão é obrigatória e não pode ser vazia: "entrar com o
    provedor X" sem filtro significa que toda conta do provedor X entra aqui.
    """
    problemas: List[str] = []
    if not base_url_valida(campos.get("base_url", "")):
        problemas.append("sso.need_base_url")
    if not url_segura(campos.get("issuer", "")) or not campos.get("issuer", "").strip():
        problemas.append("sso.need_issuer")
    if not str(campos.get("client_id", "")).strip():
        problemas.append("sso.need_client_id")
    if not tem_segredo:
        problemas.append("sso.need_secret")
    if not lista_de(campos.get("allowed_domains", "")) and not lista_de(
        campos.get("allowed_emails", "")
    ):
        problemas.append("sso.need_allowlist")
    return problemas


def configuracao_efetiva(prefs_path: str, base_dir: str) -> Optional[Dict[str, object]]:
    """A configuração que o fluxo usa, ou None quando o SSO não deve funcionar.

    Devolver None é o estado "sem configuração, nada muda": a tela de login não
    desenha o botão e as rotas `/sso/*` recusam.
    """
    if desligado_por_ambiente():
        return None

    campos = ler_configuracao(prefs_path)
    if campos["enabled"] != "oidc":
        return None

    segredo = ler_segredo(base_dir)
    if problemas_da_configuracao(campos, bool(segredo)):
        return None

    return {
        "base_url": normaliza_base_url(campos["base_url"]),
        "issuer": normaliza_base_url(campos["issuer"]),
        "client_id": campos["client_id"],
        "client_secret": segredo,
        "scopes": campos["scopes"] or SCOPES_PADRAO,
        "allowed_domains": lista_de(campos["allowed_domains"]),
        "allowed_emails": lista_de(campos["allowed_emails"]),
    }


def nome_do_provedor(config: Optional[Dict[str, object]]) -> str:
    """Como o botão de login chama o provedor: o host do emissor, e nada mais.

    Inventar um nome amigável exigiria uma tabela de provedores conhecidos que
    envelheceria calada; o host é o que o operador cadastrou e reconhece.
    """
    if not config:
        return ""
    host = urllib.parse.urlsplit(str(config.get("issuer") or "")).hostname or ""
    return host


def redirect_uri(config: Dict[str, object]) -> str:
    """Sai SEMPRE da configuração. Nunca do cabeçalho `Host`, que é do cliente."""
    return f"{config['base_url']}{ROTA_CALLBACK}"


# --- Descoberta -------------------------------------------------------------

_cache_descoberta: Dict[str, Tuple[float, Optional[Dict[str, object]]]] = {}
_trava_descoberta = threading.Lock()


def limpa_cache_descoberta() -> None:
    with _trava_descoberta:
        _cache_descoberta.clear()


def _http_json(
    url: str,
    *,
    dados: Optional[Dict[str, str]] = None,
    cabecalhos: Optional[Dict[str, str]] = None,
    timeout: float = TIMEOUT_TOKEN,
) -> Dict[str, object]:
    """Uma requisição HTTP que devolve JSON, com verificação de certificado.

    Sem `context=` de propósito: o contexto padrão do `urllib` verifica o
    certificado contra as autoridades do sistema. Passar um contexto próprio aqui
    é o caminho mais curto para alguém desligar a verificação "só para testar".
    """
    corpo = urllib.parse.urlencode(dados or {}).encode("ascii") if dados is not None else None
    pedido = urllib.request.Request(url, data=corpo, headers=cabecalhos or {})
    with urllib.request.urlopen(pedido, timeout=timeout) as resposta:
        return json.loads(resposta.read().decode("utf-8"))


Transporte = Callable[..., Dict[str, object]]


def descobre(
    issuer: str,
    *,
    http: Optional[Transporte] = None,
    agora: Optional[float] = None,
) -> Optional[Dict[str, object]]:
    """Documento de descoberta do emissor, memorizado por uma hora.

    O campo `issuer` do documento tem de ser IDÊNTICO ao emissor configurado.
    Sem essa conferência, um documento servido por outro provedor apontaria os
    nossos pedidos para os pontos de acesso dele — é a confusão entre provedores.
    """
    issuer = normaliza_base_url(issuer)
    if not issuer or not url_segura(issuer):
        return None

    agora = agora if agora is not None else time.time()
    with _trava_descoberta:
        guardado = _cache_descoberta.get(issuer)
        if guardado:
            idade = agora - guardado[0]
            if guardado[1] is not None and idade < TTL_DESCOBERTA:
                return guardado[1]
            if guardado[1] is None and idade < TTL_DESCOBERTA_FALHA:
                return None

    def _falhou(motivo: str) -> None:
        _log.warning("SSO: %s", motivo)
        with _trava_descoberta:
            _cache_descoberta[issuer] = (agora, None)

    http = http or _http_json
    try:
        documento = http(
            f"{issuer}/.well-known/openid-configuration", timeout=TIMEOUT_DESCOBERTA
        )
    except Exception:
        # Provedor fora do ar, DNS quebrado, certificado inválido: o botão some
        # da tela de login e o formulário local continua funcionando.
        _falhou("descoberta do emissor falhou")
        return None

    if not isinstance(documento, dict):
        _falhou("o documento de descoberta não é um objeto JSON")
        return None
    if normaliza_base_url(str(documento.get("issuer") or "")) != issuer:
        _falhou("o emissor do documento de descoberta não é o configurado")
        return None
    for campo in ("authorization_endpoint", "token_endpoint", "userinfo_endpoint"):
        alvo = str(documento.get(campo) or "")
        if not alvo or not url_segura(alvo):
            _falhou(f"{campo} ausente ou inseguro no documento de descoberta")
            return None

    with _trava_descoberta:
        _cache_descoberta[issuer] = (agora, documento)
    return documento


# --- PKCE -------------------------------------------------------------------


def novo_verificador() -> str:
    return secrets.token_urlsafe(64)


def desafio_de(verificador: str) -> str:
    """S256, SEMPRE. Nunca `plain`.

    O painel roda em HTTP no loopback: o código de autorização passa pela barra
    de endereços e fica no histórico do navegador. `state` e `nonce` sozinhos não
    protegem contra um código interceptado — o verificador, que só existe no
    cookie de estado, protege.
    """
    resumo = hashlib.sha256(verificador.encode("ascii")).digest()
    return base64.urlsafe_b64encode(resumo).decode("ascii").rstrip("=")


def url_de_autorizacao(config: Dict[str, object], documento: Dict[str, object],
                       state: str, nonce: str, verificador: str) -> str:
    """Para onde mandamos o navegador. O `redirect_uri` sai da configuração."""
    parametros = {
        "response_type": "code",
        "client_id": str(config["client_id"]),
        "redirect_uri": redirect_uri(config),
        "scope": str(config["scopes"]),
        "state": state,
        "nonce": nonce,
        "code_challenge": desafio_de(verificador),
        "code_challenge_method": "S256",
        # Escolher a conta explicitamente: sem isto, quem já está logado no
        # provedor entra com a conta dele sem ver qual é.
        "prompt": "select_account",
    }
    destino = str(documento["authorization_endpoint"])
    juncao = "&" if "?" in destino else "?"
    return f"{destino}{juncao}{urllib.parse.urlencode(parametros)}"


# --- Validação do id_token --------------------------------------------------


def decodifica_payload(id_token: str) -> Optional[Dict[str, object]]:
    """Lê a carga do JWT SEM verificar a assinatura (ver o cabeçalho do módulo)."""
    partes = str(id_token or "").split(".")
    if len(partes) != 3:
        return None
    bruto = partes[1]
    bruto += "=" * (-len(bruto) % 4)
    try:
        carga = json.loads(base64.urlsafe_b64decode(bruto.encode("ascii")).decode("utf-8"))
    except Exception:
        return None
    return carga if isinstance(carga, dict) else None


def problema_do_id_token(
    carga: Dict[str, object],
    *,
    issuer: str,
    client_id: str,
    nonce: str,
    agora: Optional[float] = None,
) -> str:
    """Devolve o motivo interno da recusa, ou "" quando a carga passa.

    A lista é fechada de propósito: com a assinatura fora do caminho, quem pula
    uma destas checagens está confiando que "o TLS resolve", e o TLS não diz
    nada sobre `aud`, `exp` ou `nonce`.
    """
    agora = agora if agora is not None else time.time()

    if normaliza_base_url(str(carga.get("iss") or "")) != normaliza_base_url(issuer):
        return "iss diferente do emissor configurado"

    aud = carga.get("aud")
    audiencias = aud if isinstance(aud, list) else [aud]
    if client_id not in [str(a) for a in audiencias if a is not None]:
        return "aud não contém o client_id"
    # Com mais de uma audiência, a especificação exige `azp`, e ele tem de ser
    # nós: sem isso, um token emitido para outro cliente que nos lista em `aud`
    # passaria.
    if len(audiencias) > 1 and str(carga.get("azp") or "") != client_id:
        return "azp ausente ou diferente do client_id com múltiplas audiências"

    try:
        expira = float(carga.get("exp"))
    except (TypeError, ValueError):
        return "exp ausente ou ilegível"
    if expira <= agora:
        return "id_token expirado (confira o relógio do container)"

    try:
        emitido = float(carga.get("iat"))
    except (TypeError, ValueError):
        return "iat ausente ou ilegível"
    if abs(agora - emitido) > TOLERANCIA_DE_RELOGIO:
        return "iat fora da tolerância de relógio (confira o relógio do container)"

    if not hmac.compare_digest(str(carga.get("nonce") or ""), str(nonce or "")):
        return "nonce diferente do gravado no cookie de estado"

    return ""


def email_permitido(email: str, dominios: List[str], emails: List[str]) -> bool:
    """Lista de permissão obrigatória: e-mail exato OU domínio, e nada mais."""
    email = str(email or "").strip().lower()
    if not email or "@" not in email:
        return False
    if not dominios and not emails:
        # Lista vazia nunca significa "todo mundo entra".
        return False
    if email in emails:
        return True
    return email.rsplit("@", 1)[1] in dominios


# --- O fluxo completo do retorno --------------------------------------------


def conclui_login(
    *,
    config: Dict[str, object],
    estado: Optional[Dict[str, str]],
    parametros: Dict[str, str],
    http: Optional[Transporte] = None,
    agora: Optional[float] = None,
) -> Tuple[str, str]:
    """Valida a volta do provedor. Devolve (email, motivo_da_recusa).

    E-mail vazio significa recusa. O motivo é para o log interno: na tela, toda
    falha é a MESMA frase — distinguir "state errado" de "e-mail fora da lista"
    conta ao atacante em que ponto do fluxo ele está.

    A ordem é a da especificação, e para na primeira falha.
    """
    http = http or _http_json

    # 1. Cookie de estado íntegro. Sem ele não há nada com que comparar o state,
    #    e aceitar assim mesmo é o pedido forjado de login.
    if not estado or not estado.get("state"):
        return "", "cookie de estado ausente ou corrompido"

    # 2. O state da volta bate com o do cookie.
    if not hmac.compare_digest(str(parametros.get("state") or ""), str(estado["state"])):
        return "", "state diferente do gravado no cookie"

    # 3. O provedor pode ter recusado antes de chegar aqui.
    if parametros.get("error"):
        return "", "o provedor devolveu erro na autorização"
    codigo = str(parametros.get("code") or "").strip()
    if not codigo:
        return "", "code ausente na volta do provedor"

    documento = descobre(str(config["issuer"]), http=http, agora=agora)
    if not documento:
        return "", "descoberta do emissor indisponível"

    # 4. Troca do código pelo token, pelo canal direto e autenticado. O
    #    `redirect_uri` repetido aqui é o MESMO que foi enviado na ida.
    credencial = base64.b64encode(
        f"{config['client_id']}:{config['client_secret']}".encode("utf-8")
    ).decode("ascii")
    try:
        resposta = http(
            str(documento["token_endpoint"]),
            dados={
                "grant_type": "authorization_code",
                "code": codigo,
                "redirect_uri": redirect_uri(config),
                "code_verifier": str(estado.get("verificador") or ""),
            },
            cabecalhos={
                "Authorization": f"Basic {credencial}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=TIMEOUT_TOKEN,
        )
    except Exception:
        # Nunca registre o corpo: ele carrega o code e, em caso de sucesso, os
        # tokens.
        return "", "a troca do code pelo token falhou"

    id_token = str(resposta.get("id_token") or "")
    access_token = str(resposta.get("access_token") or "")
    if not id_token or not access_token:
        return "", "resposta do token sem id_token ou sem access_token"

    carga = decodifica_payload(id_token)
    if carga is None:
        return "", "id_token ilegível"

    problema = problema_do_id_token(
        carga,
        issuer=str(config["issuer"]),
        client_id=str(config["client_id"]),
        nonce=str(estado.get("nonce") or ""),
        agora=agora,
    )
    if problema:
        return "", problema

    # 5. O userinfo prova que o access_token é real e ancora o `sub`
    #    (OIDC Core 5.3.2): um `sub` diferente é resposta de outra sessão.
    try:
        perfil = http(
            str(documento["userinfo_endpoint"]),
            cabecalhos={"Authorization": f"Bearer {access_token}"},
            timeout=TIMEOUT_TOKEN,
        )
    except Exception:
        return "", "userinfo não respondeu"
    if not isinstance(perfil, dict):
        return "", "userinfo devolveu algo que não é um objeto"
    if str(perfil.get("sub") or "") != str(carga.get("sub") or ""):
        return "", "sub do userinfo diferente do sub do id_token"

    # 6. E-mail confirmado. Sem isto, qualquer conta com e-mail não verificado
    #    entra usando o endereço de outra pessoa.
    email = str(perfil.get("email") or carga.get("email") or "").strip().lower()
    verificado = perfil.get("email_verified")
    if verificado is None:
        verificado = carga.get("email_verified")
    if verificado is not True and str(verificado).lower() != "true":
        return "", "email_verified ausente ou falso"

    # 7. Lista de permissão, obrigatória e não vazia.
    if not email_permitido(
        email,
        list(config.get("allowed_domains") or []),
        list(config.get("allowed_emails") or []),
    ):
        return "", "e-mail fora da lista de permissão"

    return email, ""


# --- SAML2 ------------------------------------------------------------------


def saml_disponivel() -> bool:
    """Se a biblioteca de SAML2 existe nesta imagem.

    SAML2 exige dependência externa: a assinatura é sobre canonicalização
    exclusiva 1.0, que `xml.etree` não faz (ele faz C14N 2.0, outro algoritmo),
    não há verificação RSA na biblioteca padrão, e a defesa contra o
    deslocamento da asserção assinada dentro da árvore é trabalho de biblioteca.
    Enquanto ela não estiver instalada — e ela não está na imagem publicada — a
    aba SAML2 da tela aparece desabilitada, dizendo isso.
    """
    try:
        import onelogin.saml2  # noqa: F401
    except Exception:
        return False
    return True

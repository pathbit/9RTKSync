"""Catalogo de modelos que o 9Router realmente serve.

Por que HTTP e nao banco: o 9Router NAO guarda o catalogo em tabela nenhuma.
Ele monta ``/v1/models`` em tempo de requisicao, juntando o registro estatico de
provedores (``PROVIDER_MODELS``, que vive no codigo do gateway) as conexoes
cadastradas, aos combos e aos modelos personalizados. Nao ha o que ler do
SQLite: perguntar ao gateway e a unica forma de saber o que ele publica.

E a diferenca estrutural para o irmao OminiRTkSync, que le o catalogo
sincronizado direto do banco. A diferenca e do gateway, nao de criterio.

A rota exige uma chave que o proprio 9Router emitiu. Ela vem de
``database.get_active_api_key``, vira cabecalho ``Authorization`` e morre aqui:
nao e renderizada, nao entra em log e nao passa por argv.
"""

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from .models import ConnectionRecord, RegisteredModelRecord

# Resultados possiveis da leitura. Sao tres porque "vazio" nao explica nada: o
# operador precisa distinguir "o gateway nao publica modelo nenhum" de "nao deu
# para perguntar", e a tela diz qual dos tres aconteceu.
CATALOGO_OK = "ok"
CATALOGO_SEM_CHAVE = "no_key"
CATALOGO_INACESSIVEL = "unreachable"

# Timeout curto: a pagina e montada no servidor e o operador espera por ela.
CATALOG_TIMEOUT_SECONDS = 6.0

USER_AGENT = "9RTKSync/1.0"

# O 9Router publica os combos no MESMO catalogo, marcados com este dono. Eles
# ficam de fora daqui porque ja tem cartao proprio -- lista-los duas vezes faria
# a contagem de modelos mentir.
DONO_DE_COMBO = "combo"


def fetch_gateway_models(
    router_url: str,
    api_key: str,
    timeout: float = CATALOG_TIMEOUT_SECONDS,
    opener: Optional[Any] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Le ``/v1/models`` do gateway e devolve ``(estado, entradas)``.

    Nunca levanta excecao: o painel inteiro nao pode cair porque o catalogo de
    um cartao nao respondeu.
    """
    if not router_url:
        return CATALOGO_INACESSIVEL, []
    if not api_key:
        return CATALOGO_SEM_CHAVE, []

    url = f"{router_url.rstrip('/')}/v1/models"
    requisicao = urllib.request.Request(url, method="GET")
    requisicao.add_header("User-Agent", USER_AGENT)
    requisicao.add_header("Authorization", f"Bearer {api_key}")

    enviar = opener or urllib.request.urlopen
    try:
        with enviar(requisicao, timeout=timeout) as resposta:
            corpo = resposta.read().decode("utf-8", errors="replace")
        dados = json.loads(corpo) if corpo.strip() else {}
    except (urllib.error.URLError, OSError, ValueError):
        # URLError cobre o HTTPError (401 de chave recusada, 5xx do gateway);
        # ValueError, a resposta que nao e JSON. Em todos, o fato observavel e o
        # mesmo: nao ha catalogo para mostrar.
        return CATALOGO_INACESSIVEL, []

    entradas = dados.get("data") if isinstance(dados, dict) else dados
    if not isinstance(entradas, list):
        return CATALOGO_INACESSIVEL, []

    modelos = []
    for entrada in entradas:
        if not isinstance(entrada, dict):
            continue
        identificador = entrada.get("id")
        dono = str(entrada.get("owned_by") or "")
        if not identificador or dono == DONO_DE_COMBO:
            continue
        modelos.append({
            "id": str(identificador),
            "name": entrada.get("name") or str(identificador),
            "provider": dono,
            "source": entrada.get("root") or "",
            "supportedEndpoints": entrada.get("supportedEndpoints") or [],
        })

    modelos.sort(key=lambda m: (m["provider"].lower(), m["id"].lower()))
    return CATALOGO_OK, modelos


def build_registered_models(
    entries: List[Dict[str, Any]], connections: List[ConnectionRecord]
) -> List[RegisteredModelRecord]:
    """Amarra cada modelo a conexao que o serve, pelo nome do provedor.

    O ``owned_by`` que o gateway devolve e o alias do provedor ("groq",
    "gemini"), o mesmo valor da coluna ``provider`` em ``providerConnections``.
    Quando nao ha conexao com aquele nome, o modelo vem do registro estatico do
    gateway e fica sem dona -- e ai a linha diz "nao verificado" em vez de
    herdar a saude de alguem.
    """
    por_provedor: Dict[str, ConnectionRecord] = {}
    for conexao in connections:
        chave = str(conexao.provider or "").lower()
        if chave and chave not in por_provedor:
            por_provedor[chave] = conexao

    return [
        RegisteredModelRecord.from_entry(
            entrada, por_provedor.get(str(entrada.get("provider") or "").lower())
        )
        for entrada in entries
    ]

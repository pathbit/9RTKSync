"""Tudo o que sabe o que ESTE gateway guarda, e onde.

Junto de `identidade.py`, é o único módulo do pacote que pode divergir dos
irmãos: os três painéis desenham as mesmas telas, mas um lê SQLite, outro lê
SQLite com outro schema e o terceiro fala HTTP com um Postgres atrás. Essa
diferença é real e não se apaga -- o que se faz é confiná-la aqui, atrás de uma
costura de assinatura fixa, para que `web.py` e `render.py` possam ser o mesmo
texto nos três.

A costura é `carregar_painel(settings)`. Ela devolve SEMPRE as mesmas oito
chaves, na mesma ordem, e nunca omite nenhuma: o gateway que não tem uma delas
devolve lista ou dicionário vazio, e a tela desenha o cartão em estado vazio --
comportamento que os três painéis já têm. Omitir a chave, em vez de esvaziá-la,
transformaria uma ausência de dado num `KeyError` no meio do render.

Este gateway guarda conexões, chaves virtuais e combos em SQLite, e NÃO guarda
o catálogo de modelos em tabela nenhuma: ele monta `/v1/models` em tempo de
requisição. Por isso a leitura do catálogo aqui é HTTP, e não SQL.
"""

import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from .identidade import NOME_DO_PRODUTO
from .models import ConnectionRecord, RegisteredModelRecord, VirtualKeyRecord

# Timeout da sondagem ao gateway. Curto de proposito: a pagina e montada no
# servidor, e o operador espera por ela. Constante nomeada porque um timeout
# esquecido aqui pendura a thread que serve a requisicao.
TIMEOUT_DE_SONDAGEM = 3.0

# Tempo de vida do catalogo memorizado. Ele sai de uma requisicao HTTP a este
# gateway e muda de hora em hora, nao de segundo em segundo: relê-lo a cada
# desenho da pagina cobraria uma viagem de rede por F5. O cache fica AQUI, e nao
# em web.py, porque o custo que ele evita e deste gateway -- o irmao que guarda
# o catalogo no proprio banco nao paga viagem nenhuma e nao precisa de cache.
TTL_DO_CATALOGO = 120.0

_catalogo_memorizado: Dict[str, tuple] = {}
_trava_do_catalogo = threading.Lock()


def get_db_connection(db_path: str) -> sqlite3.Connection:
    """Open connection to SQLite with timeout and Row factory."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"SQLite database not found at: {db_path}")
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    return conn


def get_all_connections(db_path: str) -> List[ConnectionRecord]:
    """Retrieve all registered connections from the gateway."""
    conn = get_db_connection(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, provider, name, createdAt, updatedAt, data FROM providerConnections")
        rows = cursor.fetchall()
        result = []
        for r in rows:
            result.append(
                ConnectionRecord(
                    id=r["id"],
                    provider=r["provider"],
                    name=r["name"],
                    created_at=r["createdAt"],
                    updated_at=r["updatedAt"],
                    data_raw=r["data"],
                )
            )
        return result
    finally:
        conn.close()


def update_connection_data(db_path: str, connection_id: str, new_data: Dict[str, Any]) -> bool:
    """Update connection JSON payload and timestamp updatedAt with UTC ISO string."""
    conn = get_db_connection(db_path)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        cursor = conn.cursor()
        data_str = json.dumps(new_data)
        cursor.execute(
            "UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?",
            (data_str, now_iso, connection_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def upsert_connection(
    db_path: str,
    provider: str,
    name: str,
    data: Dict[str, Any],
    connection_id: Optional[str] = None,
) -> str:
    """Insert or update a connection in SQLite ensuring compatible schema format."""
    conn = get_db_connection(db_path)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        cursor = conn.cursor()
        data_str = json.dumps(data)

        # Look up by ID or by provider
        target_id = connection_id
        if not target_id:
            cursor.execute("SELECT id FROM providerConnections WHERE provider = ?", (provider,))
            row = cursor.fetchone()
            if row:
                target_id = row["id"]

        if target_id:
            cursor.execute(
                "UPDATE providerConnections SET name = ?, data = ?, updatedAt = ? WHERE id = ?",
                (name, data_str, now_iso, target_id),
            )
            conn.commit()
            return target_id
        else:
            import uuid
            new_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO providerConnections (id, provider, name, data, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (new_id, provider, name, data_str, now_iso, now_iso),
            )
            conn.commit()
            return new_id
    finally:
        conn.close()


def upsert_combos(db_path: str, combos_list: List[tuple]) -> int:
    """
    Register or update combos without violating unique constraint on combos.name.
    combos_list: list of tuples (id, name, kind, models_json)
    """
    conn = get_db_connection(db_path)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    count = 0
    try:
        cursor = conn.cursor()
        for c_id, c_name, c_kind, c_models in combos_list:
            # Query by name or id
            cursor.execute("SELECT id FROM combos WHERE name = ? OR id = ?", (c_name, c_id))
            row = cursor.fetchone()
            if row:
                existing_id = row[0]
                cursor.execute(
                    "UPDATE combos SET models = ?, kind = ?, updatedAt = ? WHERE id = ?",
                    (c_models, c_kind, now_iso, existing_id),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO combos (id, name, kind, models, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (c_id, c_name, c_kind, c_models, now_iso, now_iso),
                )
            count += 1
        conn.commit()
        return count
    finally:
        conn.close()


def _tabela_existe(conn: sqlite3.Connection, nome: str) -> bool:
    """Se a tabela existe nesta instalacao do gateway.

    O schema do gateway cresce entre versoes. Perguntar antes de consultar e o
    que faz um cartao cair para o estado vazio em vez de derrubar a pagina toda.
    """
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (nome,)
    )
    return cursor.fetchone() is not None


def get_all_api_keys(db_path: str) -> List[Dict[str, Any]]:
    """Chaves virtuais emitidas pelo gateway (tabela ``apiKeys``), SEM o segredo.

    Chave virtual e o token que o cliente apresenta ao gateway no lugar da
    credencial do provedor -- todo gateway da familia emite uma, e o painel
    precisa mostrar quais existem e se ainda estao aceitas.

    A coluna ``key`` NAO entra na consulta: o material do token nao tem por que
    sair do banco para desenhar uma tabela. Quem precisa dele para falar com o
    gateway usa ``get_active_api_key``, que existe justamente para deixar esse
    uso visivel num lugar so.
    """
    conn = get_db_connection(db_path)
    try:
        if not _tabela_existe(conn, "apiKeys"):
            return []

        # So pede o que a instalacao realmente tem: uma coluna ausente faria a
        # consulta inteira falhar e o cartao sumir da tela.
        presentes = {linha[1] for linha in conn.execute("PRAGMA table_info(apiKeys)")}
        colunas = [c for c in ("id", "name", "machineId", "isActive", "createdAt") if c in presentes]
        if "id" not in colunas:
            return []

        resultado: List[Dict[str, Any]] = []
        for linha in conn.execute(f"SELECT {', '.join(colunas)} FROM apiKeys"):
            item = dict(linha)
            resultado.append({
                "id": str(item.get("id") or ""),
                "name": item.get("name") or "",
                "machineId": item.get("machineId") or "",
                "createdAt": item.get("createdAt"),
                # Coluna ausente vira o padrao do proprio gateway (chave ativa).
                # Assumir o contrario pintaria de vermelho toda chave de uma
                # instalacao antiga.
                "isActive": bool(item["isActive"]) if item.get("isActive") is not None else True,
            })
        resultado.sort(key=lambda k: (k["name"] or k["id"]).lower())
        return resultado
    finally:
        conn.close()


def get_active_api_key(db_path: str) -> str:
    """Uma chave ATIVA do gateway, e o unico lugar que le a coluna ``key``.

    Existe para um uso so: o cabecalho ``Authorization`` da leitura do catalogo
    de modelos. O gateway monta ``/v1/models`` em tempo de requisicao, a partir
    do registro estatico somado as conexoes vivas -- nao ha tabela de modelos
    para ler, entao a rota HTTP e a unica fonte, e ela so responde a uma chave
    que o proprio gateway emitiu.

    (O irmao cujo gateway guarda o catalogo o le direto do banco, no namespace
    ``syncedAvailableModels``, e por isso nao precisa de chave nenhuma. A
    diferenca e do gateway, nao de criterio.)

    O valor volta daqui apenas para virar cabecalho: nao e renderizado, nao
    entra em log e nao passa por argv. String vazia quando nao ha chave ativa --
    o cartao cai para o estado vazio dizendo exatamente isso.
    """
    conn = get_db_connection(db_path)
    try:
        if not _tabela_existe(conn, "apiKeys"):
            return ""
        cursor = conn.execute(
            "SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt ASC LIMIT 1"
        )
        linha = cursor.fetchone()
        return str(linha[0]) if linha and linha[0] else ""
    except sqlite3.Error:
        # Instalacao sem a coluna ``key``: sem chave, sem catalogo, sem queda.
        return ""
    finally:
        conn.close()


def get_all_combos(db_path: str) -> List[Dict[str, Any]]:
    """Return all registered combos from database."""
    conn = get_db_connection(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, kind, models, updatedAt FROM combos ORDER BY name ASC")
        rows = cursor.fetchall()
        result = []
        for r in rows:
            try:
                models = json.loads(r["models"])
            except Exception:
                models = []
            result.append({
                "id": r["id"],
                "name": r["name"],
                "kind": r["kind"],
                "models": models,
                "updatedAt": r["updatedAt"],
            })
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Catálogo de modelos: HTTP, e não SQL
# ---------------------------------------------------------------------------
#
# A rota exige uma chave que o próprio gateway emitiu. Ela vem de
# `get_active_api_key`, vira cabeçalho `Authorization` e morre aqui: não é
# renderizada, não entra em log e não passa por argv.

# Resultados possiveis da leitura. Sao tres porque "vazio" nao explica nada: o
# operador precisa distinguir "o gateway nao publica modelo nenhum" de "nao deu
# para perguntar", e a tela diz qual dos tres aconteceu.
CATALOGO_OK = "ok"
CATALOGO_SEM_CHAVE = "no_key"
CATALOGO_INACESSIVEL = "unreachable"

# Timeout curto: a pagina e montada no servidor e o operador espera por ela.
CATALOG_TIMEOUT_SECONDS = 6.0

USER_AGENT = f"{NOME_DO_PRODUTO}/1.0"

# O gateway publica os combos no MESMO catalogo, marcados com este dono. Eles
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


# ---------------------------------------------------------------------------
# A costura: a única função que `web.py` chama para saber o que desenhar
# ---------------------------------------------------------------------------


def sondar(router_url: str) -> Dict[str, Any]:
    """Diz se o gateway responde, e em quanto tempo.

    Sem cache: quem decide guardar o resultado é `web.py`, que é comum aos três.
    Aqui mora só o que é específico deste gateway -- o endereço que se pergunta
    e o que conta como "respondeu".
    """
    if not router_url:
        return {"url": router_url, "online": True, "statusCode": 200, "latencyMs": 0}
    comeco = time.time()
    try:
        pedido = urllib.request.Request(
            router_url, headers={"User-Agent": f"{NOME_DO_PRODUTO}-Healthcheck/1.0"}
        )
        with urllib.request.urlopen(pedido, timeout=TIMEOUT_DE_SONDAGEM) as resposta:
            codigo = resposta.status
    except urllib.error.HTTPError as erro:
        codigo = erro.code
    except Exception:
        codigo = 0
    return {
        "url": router_url,
        "online": 0 < codigo < 500,
        "statusCode": codigo,
        "latencyMs": int((time.time() - comeco) * 1000),
    }


def carregar_painel(settings: Any) -> Dict[str, Any]:
    """Lê deste gateway tudo o que a tela precisa, com as oito chaves de sempre.

    Assinatura fixa nos três irmãos, e as MESMAS oito chaves sempre presentes:

        connections   conexões de provedor cadastradas
        keys          chaves virtuais emitidas pelo gateway, sem o segredo
        models        catálogo de modelos que o gateway publica
        combos        combos de resiliência e fallback
        findings      achados de coerência de limites -- vazio aqui: este
                      gateway não tem orçamento nem teto por chave para conferir
        counters      quantidades já contadas, para o cartão de métricas
        probe         resultado da sondagem, ou vazio se ninguém sondou
        model_states  estado da leitura do catálogo, por fonte

    Uma chave que este gateway não tem vem VAZIA, e nunca ausente: a tela
    desenha o cartão em estado vazio, que é comportamento que os três já têm.
    Omitir a chave transformaria a ausência de dado num `KeyError` no render.
    """
    db_path = getattr(settings, "db_path", "") or ""
    router_url = getattr(settings, "router_url", "") or ""
    banco_existe = bool(db_path and os.path.exists(db_path))

    conexoes: List[Any] = []
    combos: List[Dict[str, Any]] = []
    chaves: List[Any] = []
    if banco_existe:
        try:
            conexoes = get_all_connections(db_path)
        except Exception:
            conexoes = []
        try:
            combos = get_all_combos(db_path)
        except Exception:
            combos = []
        try:
            chaves = [VirtualKeyRecord.from_row(linha) for linha in get_all_api_keys(db_path)]
        except Exception:
            chaves = []

    estado_do_catalogo, entradas = ler_catalogo(router_url, db_path)
    modelos = build_registered_models(entradas, conexoes)

    return {
        "connections": conexoes,
        "keys": chaves,
        "models": modelos,
        "combos": combos,
        # Este gateway não guarda orçamento nem teto por chave: não há o que
        # conferir, e a lista vazia é a resposta honesta.
        "findings": [],
        "counters": {
            "connections": len(conexoes),
            "keys": len(chaves),
            "models": len(modelos),
            "combos": len(combos),
            "findings": 0,
        },
        # Quem sonda é `web.py`, que guarda o resultado em cache; aqui a chave
        # existe para que o formato do retorno seja o mesmo nos três.
        "probe": {},
        "model_states": {"catalog": estado_do_catalogo, "db": "ok" if banco_existe else "missing"},
    }


def esquece_o_catalogo() -> None:
    """Descarta o catálogo memorizado para que a próxima leitura vá à rede.

    Chamado depois de uma ação do operador: sem isto, o painel continuaria a
    mostrar por até dois minutos o estado anterior ao que ele acabou de fazer.
    """
    with _trava_do_catalogo:
        _catalogo_memorizado.clear()


def ler_catalogo(router_url: str, db_path: str) -> Tuple[str, List[Dict[str, Any]]]:
    """Catálogo do gateway, memorizado por `TTL_DO_CATALOGO`.

    A chave que autentica a leitura vive só nesta pilha de chamada: entra no
    cabeçalho `Authorization` dentro de `fetch_gateway_models` e NÃO é
    memorizada -- o cache guarda apenas o resultado.
    """
    if not db_path or not os.path.exists(db_path):
        return CATALOGO_INACESSIVEL, []

    agora = time.time()
    with _trava_do_catalogo:
        gravado_em, resultado = _catalogo_memorizado.get(router_url, (0.0, None))
        if resultado is not None and (agora - gravado_em) < TTL_DO_CATALOGO:
            return resultado

    try:
        resultado = fetch_gateway_models(router_url, get_active_api_key(db_path))
    except Exception:
        # Banco travado, arquivo sumindo no meio da leitura: o cartao cai para o
        # estado vazio em vez de levar a pagina inteira junto.
        resultado = (CATALOGO_INACESSIVEL, [])

    with _trava_do_catalogo:
        _catalogo_memorizado[router_url] = (agora, resultado)
    return resultado

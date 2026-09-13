"""Safe access and mutation for 9Router SQLite database."""

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .models import ConnectionRecord


def get_db_connection(db_path: str) -> sqlite3.Connection:
    """Open connection to SQLite with timeout and Row factory."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"SQLite database not found at: {db_path}")
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    return conn


def get_all_connections(db_path: str) -> List[ConnectionRecord]:
    """Retrieve all registered connections from 9Router."""
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
    Register or update combos in 9Router without violating unique constraint on combos.name.
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

    O schema do 9Router cresce entre versoes. Perguntar antes de consultar e o
    que faz um cartao cair para o estado vazio em vez de derrubar a pagina toda.
    """
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (nome,)
    )
    return cursor.fetchone() is not None


def get_all_api_keys(db_path: str) -> List[Dict[str, Any]]:
    """Chaves virtuais emitidas pelo 9Router (tabela ``apiKeys``), SEM o segredo.

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
                # Coluna ausente vira o padrao do proprio 9Router (chave ativa).
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
    de modelos. O 9Router monta ``/v1/models`` em tempo de requisicao, a partir
    do registro estatico somado as conexoes vivas -- nao ha tabela de modelos
    para ler, entao a rota HTTP e a unica fonte, e ela so responde a uma chave
    que o proprio gateway emitiu.

    (O irmao OminiRTkSync le o catalogo direto do banco, no namespace
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

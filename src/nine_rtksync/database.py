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

"""Manager for resilience and fallback combos in the gateway SQLite database."""

import json
import sqlite3
from typing import List, Set, Tuple

from .gateway import get_all_connections, get_db_connection, upsert_combos

# Combo models are prefixed by the gateway plan ("ag/..." for Antigravity),
# while the connections table records the vendor. Map between the two so a
# combo never references a provider that has no connection in the database.
CONNECTION_PROVIDERS_OF_PREFIX = {
    "ag": {"antigravity", "gemini-cli", "google"},
}


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    """Whether the table exists in this gateway install (schema grows between versions)."""
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (name,))
    return cursor.fetchone() is not None


def available_combo_prefixes(db_path: str) -> Set[str]:
    """Provider prefixes with at least one connection or custom node registered.

    Reads both stores: OAuth/API-key connections live in ``providerConnections``
    (vendor names), and custom OpenAI-compatible endpoints (e.g. a local model
    server) live in ``providerNodes`` with the combo prefix as the node id.
    """
    prefixes: Set[str] = set()
    for connection in get_all_connections(db_path):
        provider = (connection.provider or "").strip()
        if not provider:
            continue
        for prefix, vendors in CONNECTION_PROVIDERS_OF_PREFIX.items():
            if provider in vendors:
                prefixes.add(prefix)
                break
        else:
            prefixes.add(provider)

    conn = get_db_connection(db_path)
    try:
        if _table_exists(conn, "providerNodes"):
            for (node_id,) in conn.execute("SELECT id FROM providerNodes"):
                if node_id:
                    prefixes.add(node_id)
    finally:
        conn.close()
    return prefixes


def filter_combos_to_available(
    combos: List[Tuple[str, str, str, str]], available: Set[str]
) -> Tuple[List[Tuple[str, str, str, str]], List[str]]:
    """Drop models whose provider is not registered; report combos left empty.

    Returns (combos to upsert, ids of standard combos that lost every model).
    """
    kept: List[Tuple[str, str, str, str]] = []
    emptied: List[str] = []
    for c_id, c_name, c_kind, c_models in combos:
        models = [m for m in json.loads(c_models) if m.split("/", 1)[0] in available]
        if models:
            kept.append((c_id, c_name, c_kind, json.dumps(models)))
        else:
            emptied.append(c_id)
    return kept, emptied


def remove_combos(db_path: str, combo_ids: List[str]) -> int:
    """Remove guardian-managed combos by id; user-created combos are never touched here."""
    if not combo_ids:
        return 0
    conn = get_db_connection(db_path)
    try:
        cursor = conn.cursor()
        removed = 0
        for combo_id in combo_ids:
            cursor.execute("DELETE FROM combos WHERE id = ?", (combo_id,))
            removed += cursor.rowcount
        conn.commit()
        return removed
    finally:
        conn.close()


def sync_combos(db_path: str, module: str = "all") -> int:
    """Insert or update standard combos, keeping only models with a registered provider."""
    combos = get_default_combos(module)
    available = available_combo_prefixes(db_path)
    kept, emptied = filter_combos_to_available(combos, available)
    removed = remove_combos(db_path, emptied)
    return upsert_combos(db_path, kept) + removed


def get_default_combos(module: str = "all") -> List[Tuple[str, str, str, str]]:
    """
    Return list of standard resilience combos.
    Format: (id, name, kind, models_json)
    """
    combos = [
        (
            "claudegravity-fallback",
            "claudegravity-fallback",
            "llm",
            json.dumps([
                "ag/gemini-3.8-flash-high",
                "ag/gemini-3.7-flash-high",
                "ag/gemini-3.6-flash-high",
                "ag/claude-sonnet-4-6",
                "ag/gpt-oss-120b-medium",
            ]),
        ),
        (
            "claudegravity-thinking",
            "claudegravity-thinking",
            "llm",
            json.dumps([
                "ag/claude-opus-4-6-thinking",
                "ag/claude-sonnet-4-6",
                "ag/gemini-3.8-flash-high",
                "ag/gemini-3.7-flash-high",
            ]),
        ),
    ]

    if module in ("all", "0003"):
        combos.extend([
            (
                "arsenal-supremo",
                "arsenal-supremo",
                "llm",
                json.dumps([
                    "ag/gemini-3.8-flash-high",
                    "ag/gemini-3.7-flash-high",
                    "ag/gemini-3.6-flash-high",
                    "openrouter/cohere/north-mini-code:free",
                    "groq/openai/gpt-oss-120b",
                    "mistral/codestral-latest",
                    "openai-compatible-chat-ollama-local/qwen2.5-coder:latest",
                ]),
            ),
            (
                "arsenal-rapido",
                "arsenal-rapido",
                "llm",
                json.dumps([
                    "groq/openai/gpt-oss-120b",
                    "mistral/codestral-latest",
                    "ag/gemini-3.7-flash-high",
                    "ag/gemini-3.6-flash-high",
                ]),
            ),
            (
                "arsenal-offline",
                "arsenal-offline",
                "llm",
                json.dumps([
                    "openai-compatible-chat-ollama-local/qwen2.5-coder:latest",
                ]),
            ),
        ])

    return combos


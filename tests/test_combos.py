"""Unit tests for the combos.py module."""

import json
import unittest

from nine_rtksync.combos import get_default_combos


class TestCombos(unittest.TestCase):
    def test_default_combos_all(self):
        combos = get_default_combos("all")
        names = [c[1] for c in combos]
        self.assertIn("claudegravity-fallback", names)
        self.assertIn("claudegravity-thinking", names)
        self.assertIn("arsenal-supremo", names)
        self.assertIn("arsenal-rapido", names)
        self.assertIn("arsenal-offline", names)

        # Validate that all models are parseable JSON arrays
        for _, name, kind, models_raw in combos:
            self.assertEqual(kind, "llm")
            models = json.loads(models_raw)
            self.assertIsInstance(models, list)
            self.assertGreater(len(models), 0)

    def test_default_combos_0002(self):
        combos = get_default_combos("0002")
        names = [c[1] for c in combos]
        self.assertIn("claudegravity-fallback", names)
        self.assertIn("claudegravity-thinking", names)
        self.assertNotIn("arsenal-supremo", names)


if __name__ == "__main__":
    unittest.main()



class TestCombosConnectionAware(unittest.TestCase):
    """Regression: combos must only reference providers registered in the gateway."""

    def setUp(self):
        import sqlite3
        import tempfile

        self.db_path = tempfile.mktemp(suffix=".sqlite")
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("""
            CREATE TABLE providerConnections (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            )
        """)
        c.execute("""
            CREATE TABLE providerNodes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )
        """)
        c.execute("""
            CREATE TABLE combos (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                kind TEXT NOT NULL,
                models TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()

    def tearDown(self):
        import os

        if os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def _connect(self, provider: str) -> None:
        from nine_rtksync.gateway import upsert_connection

        upsert_connection(self.db_path, provider=provider, name=provider, data={"token": "x"})

    def _combo_models(self, combo_id: str):
        import json as _json
        import sqlite3 as _sqlite3

        conn = _sqlite3.connect(self.db_path)
        row = conn.execute("SELECT models FROM combos WHERE id = ?", (combo_id,)).fetchone()
        conn.close()
        return _json.loads(row[0]) if row else None

    def test_sync_without_any_connection_removes_standard_combos(self):
        from nine_rtksync.combos import sync_combos

        sync_combos(self.db_path, module="all")
        import sqlite3

        conn = sqlite3.connect(self.db_path)
        remaining = conn.execute("SELECT id FROM combos").fetchall()
        conn.close()
        self.assertEqual(remaining, [])

    def test_sync_keeps_only_models_of_connected_providers(self):
        from nine_rtksync.combos import sync_combos

        self._connect("groq")
        sync_combos(self.db_path, module="all")
        models = self._combo_models("arsenal-rapido")
        self.assertEqual(models, ["groq/openai/gpt-oss-120b"])
        # claudegravity combos reference only ag/* providers: gone entirely
        self.assertIsNone(self._combo_models("claudegravity-fallback"))

    def test_ag_models_survive_when_antigravity_connected(self):
        from nine_rtksync.combos import sync_combos

        self._connect("antigravity")
        sync_combos(self.db_path, module="all")
        models = self._combo_models("claudegravity-fallback")
        self.assertIsNotNone(models)
        self.assertTrue(all(m.startswith("ag/") for m in models))

    def test_custom_node_prefix_keeps_offline_combo(self):
        import sqlite3

        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO providerNodes (id, name) VALUES (?, ?)",
            ("openai-compatible-chat-ollama-local", "ollama-local"),
        )
        conn.commit()
        conn.close()

        from nine_rtksync.combos import sync_combos

        sync_combos(self.db_path, module="all")
        models = self._combo_models("arsenal-offline")
        self.assertEqual(models, ["openai-compatible-chat-ollama-local/qwen2.5-coder:latest"])

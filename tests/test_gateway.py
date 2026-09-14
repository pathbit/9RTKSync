"""Unit tests for the database.py module."""

import json
import os
import sqlite3
import tempfile
import unittest

from nine_rtksync.gateway import (
    get_all_combos,
    get_all_connections,
    update_connection_data,
    upsert_combos,
    upsert_connection,
)


class TestDatabase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        self.db_path = self.tmp.name
        self.tmp.close()

        # Create schema equivalent to 9Router
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
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def test_upsert_and_get_connections(self):
        cid = upsert_connection(
            self.db_path,
            provider="antigravity",
            name="Google Antigravity Pro",
            data={"accessToken": "tok1", "expiresAt": 1789000000000},
        )
        self.assertTrue(bool(cid))

        conns = get_all_connections(self.db_path)
        self.assertEqual(len(conns), 1)
        self.assertEqual(conns[0].provider, "antigravity")
        self.assertEqual(conns[0].data["accessToken"], "tok1")

    def test_update_connection_data(self):
        cid = upsert_connection(
            self.db_path,
            provider="groq",
            name="Groq Cloud",
            data={"apiKey": "dummy_key_1"},
        )
        ok = update_connection_data(self.db_path, cid, {"apiKey": "dummy_key_2", "testStatus": "ok"})
        self.assertTrue(ok)

        conns = get_all_connections(self.db_path)
        self.assertEqual(conns[0].data["apiKey"], "dummy_key_2")
        self.assertEqual(conns[0].data["testStatus"], "ok")

    def test_upsert_combos_no_unique_constraint_violation(self):
        # Simulate initial insertion with combo_arsenal_supremo
        combos_list = [
            ("combo_arsenal_supremo", "arsenal-supremo", "llm", json.dumps(["model1", "model2"]))
        ]
        inserted = upsert_combos(self.db_path, combos_list)
        self.assertEqual(inserted, 1)

        # Second pass with different ID but same name (arsenal-supremo)
        # Should update existing record without failing UNIQUE constraint
        combos_list_pass_2 = [
            ("arsenal-supremo", "arsenal-supremo", "llm", json.dumps(["model1", "model2", "model3"]))
        ]
        updated = upsert_combos(self.db_path, combos_list_pass_2)
        self.assertEqual(updated, 1)

        all_combos = get_all_combos(self.db_path)
        self.assertEqual(len(all_combos), 1)
        self.assertEqual(all_combos[0]["name"], "arsenal-supremo")
        self.assertEqual(len(all_combos[0]["models"]), 3)


if __name__ == "__main__":
    unittest.main()


"""Unit tests for the cli.py module."""

import io
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from nine_rtksync.cli import main, print_status_table
from nine_rtksync.config import Settings
from nine_rtksync.gateway import upsert_connection


class TestCLI(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        self.db_path = self.tmp.name
        self.tmp.close()

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

        upsert_connection(
            self.db_path,
            provider="antigravity",
            name="Google Antigravity Pro",
            data={"accessToken": "tok_cli", "expiresAt": 1789000000000},
        )

    def tearDown(self):
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)

    def test_print_status_table(self):
        settings = Settings(db_path=self.db_path)
        f = io.StringIO()
        with patch("sys.stdout", f):
            print_status_table(settings)
        output = f.getvalue()
        self.assertIn("9RTKSYNC · 9ROUTER CONNECTIONS AND COMBOS STATUS", output)
        self.assertIn("antigravity", output)
        self.assertIn("Google Antigravity Pro", output)

    def test_cli_once(self):
        f = io.StringIO()
        with patch("sys.stdout", f):
            with patch("sys.argv", ["9rtksync", "--db-path", self.db_path, "--once"]):
                main()
        output = f.getvalue()
        self.assertIn("Synchronization completed", output)


if __name__ == "__main__":
    unittest.main()


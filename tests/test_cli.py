"""Unit tests for the cli.py module."""

import io
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
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
                kind TEXT,
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

    def test_print_status_table_for_combo_without_kind(self):
        with sqlite3.connect(self.db_path) as database:
            database.execute(
                "INSERT INTO combos VALUES (?, ?, ?, ?, ?, ?)",
                ("combo-local", "Combo local", None, '["local/model"]', "", ""),
            )

        output = io.StringIO()
        with patch("sys.stdout", output):
            print_status_table(Settings(db_path=self.db_path))

        self.assertIn("Combo local", output.getvalue())
        self.assertIn("1: local/model", output.getvalue())

    def test_cli_once(self):
        f = io.StringIO()
        with patch("sys.stdout", f):
            with patch("sys.argv", ["9rtksync", "--db-path", self.db_path, "--once"]):
                main()
        output = f.getvalue()
        self.assertIn("Synchronization completed", output)

    def run_once_in_isolation(self, db_path):
        source = Path(__file__).resolve().parents[1] / "src"
        with tempfile.TemporaryDirectory() as workspace:
            environment = {
                "PYTHONPATH": str(source),
                "HOST_HOME": workspace,
                "DATA_DIR": workspace,
                "LOG_DIR": os.path.join(workspace, "logs"),
                "LOG_TO_STDOUT": "0",
            }
            if os.name == "nt":
                environment["SystemRoot"] = os.environ["SystemRoot"]
            return subprocess.run(
                [sys.executable, "-m", "nine_rtksync", "--once", "--db-path", str(db_path)],
                cwd=workspace,
                env=environment,
                capture_output=True,
                text=True,
                timeout=10,
            )

    def test_cli_once_reports_corrupt_database_without_traceback(self):
        invalid_db = Path(self.db_path)
        invalid_db.write_text("This is a synthetic invalid database.", encoding="utf-8")

        result = self.run_once_in_isolation(invalid_db)

        self.assertEqual(result.returncode, 1)
        self.assertIn("Synchronization failed: file is not a database", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertNotIn("Synchronization completed", result.stdout)

    def test_cli_once_reports_waiting_for_missing_database(self):
        result = self.run_once_in_isolation(Path(self.db_path).with_suffix(".missing"))

        self.assertEqual(result.returncode, 0)
        self.assertIn("Waiting for the gateway to create its database", result.stdout)
        self.assertNotIn("Synchronization completed", result.stdout)


if __name__ == "__main__":
    unittest.main()


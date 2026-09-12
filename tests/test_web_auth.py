"""HTTP Basic Auth authentication and protected routes tests for 9RTKSync."""

import base64
import json
import os
import sqlite3
import tempfile
import urllib.error
import urllib.request
import unittest

from nine_rtksync.config import Settings
from nine_rtksync.web.server import start_web_server


class TestWebAuth(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp_dir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.tmp_dir.name, "data.sqlite")
        with sqlite3.connect(cls.db_path) as conn:
            conn.execute("CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT, name TEXT, data TEXT, created_at TEXT, updated_at TEXT)")
            conn.execute("CREATE TABLE combos (id TEXT PRIMARY KEY, name TEXT, kind TEXT, models TEXT, created_at TEXT, updated_at TEXT)")

        cls.settings = Settings(
            db_path=cls.db_path,
            web_host="127.0.0.1",
            web_port=19195,
            dashboard_user="admin",
            dashboard_password="testpassword",
        )
        cls.server = start_web_server(
            host=cls.settings.web_host,
            port=cls.settings.web_port,
            db_path=cls.settings.db_path,
            settings=cls.settings,
        )

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp_dir.cleanup()

    def test_healthz_unauthenticated(self):
        """The /healthz route must respond 200 OK without requiring authentication."""
        url = f"http://127.0.0.1:{self.settings.web_port}/healthz"
        with urllib.request.urlopen(url, timeout=3.0) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.read(), b"OK")

    def test_dashboard_rejects_without_auth(self):
        """Accessing root without credentials must return 401 Unauthorized with WWW-Authenticate."""
        url = f"http://127.0.0.1:{self.settings.web_port}/"
        try:
            urllib.request.urlopen(url, timeout=3.0)
            self.fail("Expected HTTPError 401")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 401)
            self.assertIn("Basic", e.headers.get("WWW-Authenticate", ""))

    def test_dashboard_rejects_invalid_auth(self):
        """Access with invalid credentials must return 401."""
        url = f"http://127.0.0.1:{self.settings.web_port}/api/status"
        bad_token = base64.b64encode(b"admin:wrongpass").decode("utf-8")
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {bad_token}"})
        try:
            urllib.request.urlopen(url, timeout=3.0)
            self.fail("Expected HTTPError 401")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 401)

    def test_dashboard_accepts_valid_auth(self):
        """Access with valid credentials must return 200 OK."""
        url = f"http://127.0.0.1:{self.settings.web_port}/api/status"
        valid_token = base64.b64encode(b"admin:testpassword").decode("utf-8")
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {valid_token}"})
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["status"], "online")
            self.assertEqual(data["currentUser"], "admin")


if __name__ == "__main__":
    unittest.main()


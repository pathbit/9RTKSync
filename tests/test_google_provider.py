"""Testes unitários para o provedor Google (GoogleProvider)."""

import json
import os
import tempfile
import time
import unittest

from nine_rtksync.models import ConnectionRecord
from nine_rtksync.providers.google import GoogleProvider


class TestGoogleProvider(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
        self.tmp_path = self.tmp.name
        self.tmp.close()

    def tearDown(self):
        if os.path.exists(self.tmp_path):
            os.unlink(self.tmp_path)

    def test_can_handle(self):
        prov = GoogleProvider()
        conn_ag = ConnectionRecord(
            id="1", provider="antigravity", name="Antigravity", created_at="", updated_at="", data_raw='{"accessToken":"a"}'
        )
        conn_gem = ConnectionRecord(
            id="2", provider="gemini-cli", name="Gemini", created_at="", updated_at="", data_raw='{"accessToken":"b"}'
        )
        conn_other = ConnectionRecord(
            id="3", provider="groq", name="Groq", created_at="", updated_at="", data_raw='{"apiKey":"k"}'
        )
        self.assertTrue(prov.can_handle(conn_ag))
        self.assertTrue(prov.can_handle(conn_gem))
        self.assertFalse(prov.can_handle(conn_other))

    def test_sync_from_local_file_when_newer(self):
        with open(self.tmp_path, "w", encoding="utf-8") as f:
            json.dump({"access_token": "new_token_host", "refresh_token": "new_refresh"}, f)

        prov = GoogleProvider(credential_paths=[self.tmp_path])
        conn = ConnectionRecord(
            id="1",
            provider="antigravity",
            name="Google Antigravity Pro",
            created_at="",
            updated_at="",
            data_raw='{"accessToken":"old_token","expiresAt":1700000000000}',
        )

        renewed, new_data, notes = prov.check_and_refresh(conn, margin_seconds=900)
        self.assertTrue(renewed)
        self.assertEqual(new_data["accessToken"], "new_token_host")
        self.assertEqual(new_data["refreshToken"], "new_refresh")
        self.assertTrue(any("arquivo de credencial local do host" in n for n in notes))

    def test_no_refresh_when_valid_and_no_local_override(self):
        prov = GoogleProvider(credential_paths=[])
        future_ms = int(time.time() * 1000) + 3600000  # 60 min restantes
        conn = ConnectionRecord(
            id="1",
            provider="antigravity",
            name="Google Antigravity Pro",
            created_at="",
            updated_at="",
            data_raw=json.dumps({"accessToken": "valid_token", "expiresAt": future_ms}),
        )

        renewed, new_data, notes = prov.check_and_refresh(conn, margin_seconds=900)
        self.assertFalse(renewed)
        self.assertIsNone(new_data)
        self.assertTrue(any("Token válido por mais" in n for n in notes))


if __name__ == "__main__":
    unittest.main()

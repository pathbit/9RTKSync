"""Unit tests for the universal host discovery engine."""

import json
import os
import shutil
import tempfile
import unittest

from nine_rtksync.discovery import HostDiscoveryEngine
from nine_rtksync.models import ConnectionRecord
from nine_rtksync.providers.api_keys import ApiKeyProvider
from nine_rtksync.providers.google import GoogleProvider
from nine_rtksync.providers.local import LocalProvider
from nine_rtksync.providers.oauth import GenericOAuthProvider


class TestDiscoveryEngine(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.engine = HostDiscoveryEngine(host_home=self.tmp_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_discover_google(self):
        gemini_dir = os.path.join(self.tmp_dir, ".gemini")
        os.makedirs(gemini_dir, exist_ok=True)
        token_path = os.path.join(gemini_dir, "oauth_creds.json")
        with open(token_path, "w") as f:
            json.dump({
                "access_token": "ya29.test_google_discovery",
                "refresh_token": "1//test_google_refresh",
                "client_id": "test_cid.apps.googleusercontent.com",
                "client_secret": "test_sec",
                "expiry_date": 1800000000000,
            }, f)

        res = self.engine.discover_google()
        self.assertIsNotNone(res)
        self.assertEqual(res["accessToken"], "ya29.test_google_discovery")
        self.assertEqual(res["refreshToken"], "1//test_google_refresh")

    def test_discover_claude(self):
        claude_dir = os.path.join(self.tmp_dir, ".claude")
        os.makedirs(claude_dir, exist_ok=True)
        with open(os.path.join(claude_dir, "settings.json"), "w") as f:
            json.dump({
                "env": {
                    "ANTHROPIC_API_KEY": "sk-ant-test-key-claude",
                    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
                }
            }, f)

        res = self.engine.discover_claude()
        self.assertIsNotNone(res)
        self.assertEqual(res["apiKey"], "sk-ant-test-key-claude")

    def test_discover_codex_openai(self):
        codex_dir = os.path.join(self.tmp_dir, ".codex")
        os.makedirs(codex_dir, exist_ok=True)
        with open(os.path.join(codex_dir, "auth.json"), "w") as f:
            json.dump({
                "auth_mode": "oauth",
                "OPENAI_API_KEY": "sk-openai-test-key",
                "tokens": {
                    "access_token": "tok_access_123",
                    "refresh_token": "tok_refresh_456",
                }
            }, f)

        res = self.engine.discover_codex_openai()
        self.assertIsNotNone(res)
        self.assertEqual(res["accessToken"], "tok_access_123")
        self.assertEqual(res["apiKey"], "sk-openai-test-key")

    def test_providers_with_discovery(self):
        # 1. Google Provider uses discovery
        gemini_dir = os.path.join(self.tmp_dir, ".gemini")
        os.makedirs(gemini_dir, exist_ok=True)
        with open(os.path.join(gemini_dir, "oauth_creds.json"), "w") as f:
            json.dump({"access_token": "ya29.host_new", "refresh_token": "1//ref"}, f)

        gp = GoogleProvider(discovery=self.engine)
        conn = ConnectionRecord(
            id="c1",
            provider="antigravity",
            name="Google Test",
            created_at="2026-01-01",
            updated_at="2026-01-01",
            data_raw=json.dumps({"accessToken": "old_token", "expiresAt": 1000}),
        )
        mod, data, msgs = gp.check_and_refresh(conn)
        self.assertTrue(mod)
        self.assertEqual(data["accessToken"], "ya29.host_new")

        # 2. ApiKey Provider uses discovery
        claude_dir = os.path.join(self.tmp_dir, ".claude")
        os.makedirs(claude_dir, exist_ok=True)
        with open(os.path.join(claude_dir, "settings.json"), "w") as f:
            json.dump({"env": {"ANTHROPIC_API_KEY": "sk-ant-new-host"}}, f)

        ap = ApiKeyProvider(discovery=self.engine)
        conn_claude = ConnectionRecord(
            id="c2",
            provider="claude",
            name="Claude Anthropic",
            created_at="2026-01-01",
            updated_at="2026-01-01",
            data_raw=json.dumps({"apiKey": "old-key"}),
        )
        mod, data, msgs = ap.check_and_refresh(conn_claude)
        self.assertTrue(mod)
        self.assertEqual(data["apiKey"], "sk-ant-new-host")

        # 3. Local Provider handles Ollama
        lp = LocalProvider()
        conn_ollama = ConnectionRecord(
            id="c3",
            provider="openai-compatible-chat-ollama-local",
            name="Ollama Local",
            created_at="2026-01-01",
            updated_at="2026-01-01",
            data_raw=json.dumps({"baseUrl": "http://127.0.0.1:11434/v1"}),
        )
        self.assertTrue(lp.can_handle(conn_ollama))
        mod, data, msgs = lp.check_and_refresh(conn_ollama)
        self.assertTrue(mod)
        self.assertEqual(data["testStatus"], "active")


if __name__ == "__main__":
    unittest.main()


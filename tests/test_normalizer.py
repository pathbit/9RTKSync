"""Unit tests for the normalizer.py module."""

import time
import unittest

from nine_rtksync.normalizer import normalize_connection_data, parse_iso_or_str_to_ms


class TestNormalizer(unittest.TestCase):
    def test_parse_iso_string_to_ms(self):
        # 2026-09-12T12:00:00Z in epoch ms
        iso = "2026-09-12T12:00:00Z"
        ms = parse_iso_or_str_to_ms(iso)
        self.assertIsInstance(ms, int)
        self.assertGreater(ms, 1700000000000)

    def test_parse_seconds_converts_to_ms(self):
        sec = 1789217647
        ms = parse_iso_or_str_to_ms(sec)
        self.assertEqual(ms, 1789217647000)

    def test_parse_none_or_empty(self):
        self.assertIsNone(parse_iso_or_str_to_ms(None))
        self.assertIsNone(parse_iso_or_str_to_ms(""))
        self.assertIsNone(parse_iso_or_str_to_ms("invalid-non-iso"))

    def test_normalize_fixes_iso_expires_at(self):
        raw = {
            "accessToken": "tok_123",
            "refreshToken": "ref_123",
            "expiresAt": "2026-09-12T15:00:00.000Z",
        }
        modified, data, notes = normalize_connection_data(raw)
        self.assertTrue(modified)
        self.assertIsInstance(data["expiresAt"], int)
        self.assertGreater(data["expiresAt"], 1700000000000)
        self.assertTrue(any("converted from ISO" in n for n in notes))

    def test_normalize_clears_expired_rate_limit(self):
        past_ms = int(time.time() * 1000) - 60000  # 1 min ago
        raw = {
            "apiKey": "sk-test",
            "rateLimitedUntil": past_ms,
            "backoffLevel": 3,
        }
        modified, data, notes = normalize_connection_data(raw)
        self.assertTrue(modified)
        self.assertNotIn("rateLimitedUntil", data)
        self.assertEqual(data["backoffLevel"], 0)
        self.assertTrue(any("Expired rateLimitedUntil" in n for n in notes))

    def test_normalize_preserves_intact_data(self):
        future_ms = int(time.time() * 1000) + 3600000
        raw = {
            "accessToken": "tok_123",
            "expiresAt": future_ms,
            "testStatus": "ok",
        }
        modified, data, notes = normalize_connection_data(raw)
        self.assertFalse(modified)
        self.assertEqual(data["expiresAt"], future_ms)
        self.assertEqual(len(notes), 0)


if __name__ == "__main__":
    unittest.main()


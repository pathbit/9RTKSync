"""Testes unitários para o módulo combos.py."""

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

        # Valida que todos os modelos sao arrays JSON parseáveis
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

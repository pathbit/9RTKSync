"""Unit tests for environment variable and .env file loading."""

import os
import tempfile
import unittest
from nine_rtksync.config import load_dotenv, Settings


class TestConfigEnv(unittest.TestCase):
    def setUp(self):
        self._orig_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._orig_env)

    def test_load_dotenv_parses_key_values_and_quotes(self):
        with tempfile.NamedTemporaryFile(mode="w+", delete=False, encoding="utf-8") as f:
            f.write("# Comment\n")
            f.write("TEST_ENV_VAR1=value_one\n")
            f.write('TEST_ENV_VAR2="value with quotes"\n')
            f.write("TEST_ENV_VAR3='value with single quotes'\n")
            f.write("TEST_EXISTING=new_value\n")
            temp_path = f.name

        try:
            os.environ["TEST_EXISTING"] = "original_value"
            load_dotenv(temp_path)

            self.assertEqual(os.environ.get("TEST_ENV_VAR1"), "value_one")
            self.assertEqual(os.environ.get("TEST_ENV_VAR2"), "value with quotes")
            self.assertEqual(os.environ.get("TEST_ENV_VAR3"), "value with single quotes")
            # Should not overwrite existing environment variables
            self.assertEqual(os.environ.get("TEST_EXISTING"), "original_value")
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_settings_from_env_loads_custom_env_file(self):
        with tempfile.NamedTemporaryFile(mode="w+", delete=False, encoding="utf-8") as f:
            f.write("DASHBOARD_USER=custom_admin\n")
            f.write("DASHBOARD_PASSWORD=custom_pass\n")
            f.write("SYNC_INTERVAL=120\n")
            temp_path = f.name

        try:
            os.environ.pop("DASHBOARD_USER", None)
            os.environ.pop("DASHBOARD_PASSWORD", None)
            os.environ.pop("SYNC_INTERVAL", None)

            settings = Settings.from_env(env_file=temp_path)
            self.assertEqual(settings.dashboard_user, "custom_admin")
            self.assertEqual(settings.dashboard_password, "custom_pass")
            self.assertEqual(settings.sync_interval, 120)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)


if __name__ == "__main__":
    unittest.main()


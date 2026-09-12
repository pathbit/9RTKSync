"""Testes unitários para o CronScheduler do 9RTKSync."""

import time
import unittest

from nine_rtksync.cron import CronScheduler


class TestCronScheduler(unittest.TestCase):
    def test_cron_trigger_and_history(self):
        calls = []

        def mock_sync():
            calls.append(time.time())
            return {"success": True, "total_connections": 5, "refreshed": 2}

        cron = CronScheduler(sync_callback=mock_sync, interval_seconds=60, name="TestCron")
        status_init = cron.get_status()
        self.assertFalse(status_init["active"])
        self.assertEqual(status_init["totalRuns"], 0)

        # Disparo manual
        res = cron.trigger_now()
        self.assertTrue(res["success"])
        self.assertEqual(res["totalInspected"], 5)
        self.assertEqual(res["refreshedCount"], 2)
        self.assertEqual(len(calls), 1)

        status_after = cron.get_status()
        self.assertEqual(status_after["totalRuns"], 1)
        self.assertEqual(status_after["totalRenewals"], 2)
        self.assertEqual(len(status_after["history"]), 1)
        self.assertIsNotNone(status_after["lastRunAt"])
        self.assertIsNotNone(status_after["nextRunAt"])


if __name__ == "__main__":
    unittest.main()

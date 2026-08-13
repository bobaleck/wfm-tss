import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.core import database
from app.models.audit import AnalyticsCache
from app.services import analytics_cache


class AnalyticsCacheTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        AnalyticsCache.__table__.create(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        analytics_cache._registry.clear()
        analytics_cache._key_locks.clear()
        analytics_cache._refreshing.clear()

    def tearDown(self):
        analytics_cache._registry.clear()
        analytics_cache._key_locks.clear()
        analytics_cache._refreshing.clear()
        self.engine.dispose()

    def test_real_local_sqlite_mode_bypasses_persistent_cache(self):
        calls = []

        def compute():
            calls.append(1)
            return {"value": len(calls)}

        with patch.object(analytics_cache, "engine", self.engine):
            self.assertFalse(analytics_cache.is_enabled())
            first = analytics_cache.cached_call("local", "partner", {}, compute)
            second = analytics_cache.cached_call("local", "partner", {}, compute)

        self.assertEqual(first, {"value": 1})
        self.assertEqual(second, {"value": 2})
        self.assertEqual(len(calls), 2)

    def test_sqlite_init_does_not_create_analytics_cache_table(self):
        local_engine = create_engine("sqlite:///:memory:")
        try:
            with patch.object(database, "engine", local_engine):
                database.init_db()
            self.assertNotIn("analytics_cache", inspect(local_engine).get_table_names())
        finally:
            local_engine.dispose()

    def test_shared_snapshot_avoids_duplicate_source_calls(self):
        calls = []

        def compute():
            calls.append(1)
            return {"rows": [1, 2, 3]}

        with (
            patch.object(analytics_cache, "is_enabled", return_value=True),
            patch.object(analytics_cache, "SessionLocal", self.session_factory),
        ):
            first = analytics_cache.cached_call("workload", "partner", {"day": "2026-08-01"}, compute)
            second = analytics_cache.cached_call("workload", "partner", {"day": "2026-08-01"}, compute)

        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)

    def test_repeated_registration_keeps_in_flight_job_identity(self):
        first = analytics_cache._register("key", "workload", "partner", lambda: 1)
        second = analytics_cache._register("key", "workload", "partner", lambda: 2)

        self.assertIs(first, second)
        self.assertEqual(second.compute(), 2)

    def test_valid_source_result_survives_snapshot_write_failure(self):
        with (
            patch.object(analytics_cache, "is_enabled", return_value=True),
            patch.object(analytics_cache, "SessionLocal", self.session_factory),
            patch.object(analytics_cache, "_store", side_effect=RuntimeError("cache write failed")),
        ):
            value = analytics_cache.cached_call(
                "workload",
                "partner",
                {"day": "2026-08-01"},
                lambda: {"source": "ok"},
            )

        self.assertEqual(value, {"source": "ok"})

    def test_stale_snapshot_is_returned_while_refresh_starts(self):
        params = {"day": "2026-08-01"}
        with (
            patch.object(analytics_cache, "is_enabled", return_value=True),
            patch.object(analytics_cache, "SessionLocal", self.session_factory),
        ):
            analytics_cache.cached_call("workload", "partner", params, lambda: {"version": "old"})
            db = self.session_factory()
            try:
                row = db.query(AnalyticsCache).one()
                row.expires_at = datetime.utcnow() - timedelta(seconds=1)
                row.fetched_at = datetime.utcnow()
                db.commit()
            finally:
                db.close()

            with patch.object(analytics_cache, "_start_refresh") as start_refresh:
                value = analytics_cache.cached_call(
                    "workload",
                    "partner",
                    params,
                    lambda: (_ for _ in ()).throw(RuntimeError("source unavailable")),
                )

        self.assertEqual(value, {"version": "old"})
        start_refresh.assert_called_once()

    def test_partner_invalidation_deletes_only_its_snapshots(self):
        with (
            patch.object(analytics_cache, "is_enabled", return_value=True),
            patch.object(analytics_cache, "SessionLocal", self.session_factory),
        ):
            analytics_cache.cached_call("queues", "one", {}, lambda: [1])
            analytics_cache.cached_call("queues", "two", {}, lambda: [2])
            analytics_cache.invalidate_partner("one")

            db = self.session_factory()
            try:
                partners = [row[0] for row in db.query(AnalyticsCache.partner_uuid).all()]
            finally:
                db.close()

        self.assertEqual(partners, ["two"])


if __name__ == "__main__":
    unittest.main()

import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.v1 import analytics
from app.models.audit import QueueSetting
from app.models.user import User
from app.services import naumen_db


class HiddenQueueSqlTests(unittest.TestCase):
    def _assert_inbound_filter(self, call, expected_name="Скрытая очередь"):
        query, params = call.call_args.args[:2]
        self.assertIn("hidden_queue_names", query)
        self.assertEqual(params["hidden_queue_names"], [expected_name])

    @patch.object(naumen_db, "_execute", return_value=[])
    def test_hidden_inbound_queue_is_applied_to_statistical_queries(self, execute):
        hidden = ["Скрытая очередь"]

        naumen_db.get_workload("partner", "2026-01-01", "2026-01-02", hidden_queue_names=hidden)
        self._assert_inbound_filter(execute)

        naumen_db.get_operator_load("partner", "2026-01-01", "2026-01-02", hidden_queue_names=hidden)
        self._assert_inbound_filter(execute)

        naumen_db.get_status_summary("partner", "2026-01-01", "2026-01-02", hidden_queue_names=hidden)
        self._assert_inbound_filter(execute)

        naumen_db.get_operator_load_by_queue(
            "partner", "2026-01-01", "2026-01-02", hidden_queue_names=hidden,
        )
        self._assert_inbound_filter(execute)

        naumen_db.get_actual_operators_by_queue(
            "partner", "2026-01-01", "2026-01-02", hidden_queue_names=hidden,
        )
        self._assert_inbound_filter(execute)

        naumen_db.get_actual_operators_union(
            "partner", "2026-01-01", "2026-01-02", hidden_queue_names=hidden,
        )
        self._assert_inbound_filter(execute)

        naumen_db.get_current_operators_for_project("partner", hidden_queue_names=hidden)
        self._assert_inbound_filter(execute)

        naumen_db.get_operator_queues_map("partner", hidden_queue_names=hidden)
        self._assert_inbound_filter(execute)

    @patch.object(naumen_db, "_execute", return_value=[])
    def test_empty_outbound_project_filter_means_no_projects(self, execute):
        naumen_db.get_outbound_operator_load(
            "partner", "2026-01-01", "2026-01-02", project_ids=[],
        )
        query, params = execute.call_args.args[:2]
        self.assertIn("d.project_id = ANY(%(pids)s)", query)
        self.assertEqual(params["pids"], [])

    @patch.object(naumen_db, "_execute_multi", return_value=[[], [], [], []])
    def test_outbound_summary_keeps_explicit_visible_project_filter(self, execute_multi):
        naumen_db.get_outbound_summary(
            "partner", "2026-01-01", "2026-01-02", project_ids=["visible-project"],
        )
        queries = execute_multi.call_args.args[0]
        for query, params in queries:
            self.assertIn("d.project_id = ANY(%(pids)s)", query)
            self.assertEqual(params["pids"], ["visible-project"])


class HiddenQueueApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        QueueSetting.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.db.add_all([
            QueueSetting(partner_uuid="partner", queue_name="Видимая", hidden=False),
            QueueSetting(partner_uuid="partner", queue_name="Скрытая", hidden=True),
            QueueSetting(partner_uuid="partner", queue_name="out:visible-id", hidden=False),
            QueueSetting(partner_uuid="partner", queue_name="out:hidden-id", hidden=True),
        ])
        self.db.commit()
        self.admin = User(id=1, username="admin", role="admin", is_superuser=True)
        self.overrides_patch = patch.object(analytics, "_build_overrides", return_value=None)
        self.overrides_patch.start()
        analytics._outbound_list_cache.clear()

    def tearDown(self):
        self.overrides_patch.stop()
        self.db.close()
        self.engine.dispose()
        analytics._outbound_list_cache.clear()

    @patch.object(analytics.naumen, "get_queues", return_value=[
        {"name": "Видимая"}, {"name": "Скрытая"},
    ])
    def test_queue_list_hides_for_analytics_but_keeps_for_settings(self, _get_queues):
        visible = analytics.get_queues("partner", False, self.db, self.admin)["data"]
        settings = analytics.get_queues("partner", True, self.db, self.admin)["data"]

        self.assertEqual([q["name"] for q in visible], ["Видимая"])
        self.assertEqual([q["name"] for q in settings], ["Видимая", "Скрытая"])
        self.assertTrue(next(q for q in settings if q["name"] == "Скрытая")["hidden"])

    @patch.object(analytics.naumen, "get_outbound_projects", return_value=[
        {"project_uuid": "visible-id", "name": "Видимый исход"},
        {"project_uuid": "hidden-id", "name": "Скрытый исход"},
    ])
    def test_outbound_list_hides_for_analytics_but_keeps_for_settings(self, _get_projects):
        visible = analytics.outbound_projects_ep("partner", False, self.db, self.admin)["data"]
        settings = analytics.outbound_projects_ep("partner", True, self.db, self.admin)["data"]

        self.assertEqual([p["project_uuid"] for p in visible], ["visible-id"])
        self.assertEqual(
            [p["project_uuid"] for p in settings], ["visible-id", "hidden-id"],
        )
        self.assertTrue(next(p for p in settings if p["project_uuid"] == "hidden-id")["hidden"])


if __name__ == "__main__":
    unittest.main()

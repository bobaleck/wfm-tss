"""
Read-only сервис для работы с PostgreSQL Naumen (nccrep).
Все запросы — только SELECT к разрешённым таблицам из ncc_schema.md.
"""
from typing import Optional, Any
import psycopg2
import psycopg2.extras
from app.core.config import settings


def _get_conn(overrides: Optional[dict] = None):
    """Открывает соединение с Naumen PostgreSQL."""
    cfg = {
        "host": settings.NCC_DB_HOST,
        "database": settings.NCC_DB_NAME,
        "user": settings.NCC_DB_USER,
        "password": settings.NCC_DB_PASSWORD,
        "port": settings.NCC_DB_PORT,
        "connect_timeout": 10,
    }
    if overrides:
        cfg.update(overrides)
    missing = [k for k in ("host", "database", "user") if not cfg.get(k)]
    if missing:
        raise ValueError(f"Naumen DB не настроен. Заполните поля интеграции: {missing}")
    return psycopg2.connect(**cfg, cursor_factory=psycopg2.extras.RealDictCursor)


def _execute(query: str, params: dict = None, overrides: dict = None) -> list[dict]:
    conn = _get_conn(overrides)
    try:
        with conn.cursor() as cur:
            cur.execute(query, params or {})
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


# ─── Проекты ──────────────────────────────────────────────────────────────────

def get_projects(overrides: dict = None) -> list[dict]:
    query = """
    WITH active_projects AS (
        SELECT
            'incoming'  AS project_type,
            partneruuid AS partner_uuid,
            partnername AS partner_name,
            uuid        AS project_uuid
        FROM mv_incoming_call_project
        WHERE removed = false AND state = 'Активный'
        UNION ALL
        SELECT
            'outcoming' AS project_type,
            partneruuid AS partner_uuid,
            partnername AS partner_name,
            uuid        AS project_uuid
        FROM mv_outcoming_call_project
        WHERE removed = false AND state = 'Активный'
    )
    SELECT
        p.uuid                    AS customer_uuid,
        p.partnername             AS customer_name,
        p.partnertypetitle        AS customer_type,
        p.conditiontitle          AS customer_condition,
        p.responsiblemanagertitle AS responsible_manager,
        COUNT(ap.project_uuid)    AS active_projects_count,
        COUNT(ap.project_uuid) FILTER (WHERE ap.project_type = 'incoming')  AS active_incoming_count,
        COUNT(ap.project_uuid) FILTER (WHERE ap.project_type = 'outcoming') AS active_outcoming_count
    FROM active_projects ap
    LEFT JOIN mv_partner p ON p.uuid = ap.partner_uuid
    WHERE p.removed = false AND p.conditiontitle = 'Активный'
    GROUP BY p.uuid, p.partnername, p.partnertypetitle, p.conditiontitle, p.responsiblemanagertitle
    ORDER BY p.partnername
    """
    return _execute(query, overrides=overrides)


# ─── Очереди ──────────────────────────────────────────────────────────────────

def get_queues(partner_uuid: str, overrides: dict = None) -> list[dict]:
    query = """
    SELECT
        uuid                  AS queue_uuid,
        title                 AS name,
        datachannel           AS channel,
        servicelevelparameter AS target_sl,
        calllimit             AS answer_sec,
        state                 AS status
    FROM mv_incoming_call_project
    WHERE partneruuid = %(partner_uuid)s
      AND removed = false
      AND state = 'Активный'
    ORDER BY title
    """
    return _execute(query, {"partner_uuid": partner_uuid}, overrides)


# ─── Нагрузка ─────────────────────────────────────────────────────────────────

def get_workload(partner_uuid: str, begin_date: str, end_date: str,
                 interval: str = "hour", overrides: dict = None) -> list[dict]:
    trunc = "hour" if interval == "hour" else "day"
    query = f"""
    SELECT
        date_trunc('{trunc}', que.enqueued_time)                   AS period_start,
        icp.title                                                    AS queue_name,
        COUNT(*)                                                     AS total,
        COUNT(*) FILTER (WHERE que.final_stage = 'operator')        AS handled,
        COUNT(*) FILTER (WHERE COALESCE(que.final_stage,'') <> 'operator') AS lost,
        ROUND(AVG(
            EXTRACT(EPOCH FROM (cl.ended - cl.connected))
        ) FILTER (
            WHERE que.final_stage = 'operator'
              AND cl.connected IS NOT NULL AND cl.ended IS NOT NULL
        )::numeric, 1)                                              AS avg_talk_sec,
        CASE WHEN MAX(icp.calllimit) > 0 THEN ROUND(
            100.0 * COUNT(*) FILTER (
                WHERE que.final_stage = 'operator'
                  AND que.unblocked_time_duration <= icp.calllimit * 1000
            ) / NULLIF(COUNT(*), 0), 2)
        ELSE NULL END                                               AS sl_percent
    FROM queued_calls_ms que
    JOIN mv_incoming_call_project icp ON icp.uuid = que.project_id
    LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                           AND cl.leg_id = que.next_leg_id
    WHERE icp.partneruuid = %(partner_uuid)s
      AND icp.removed = false
      AND que.enqueued_time >= %(begin_date)s::timestamp
      AND que.enqueued_time <  %(end_date)s::timestamp
    GROUP BY date_trunc('{trunc}', que.enqueued_time), icp.title
    ORDER BY period_start, queue_name
    """
    return _execute(query, {"partner_uuid": partner_uuid, "begin_date": begin_date, "end_date": end_date}, overrides)


# ─── Операторская нагрузка ────────────────────────────────────────────────────

def get_operator_load(partner_uuid: str, begin_date: str, end_date: str,
                      overrides: dict = None) -> list[dict]:
    query = """
    WITH active_queues AS (
        SELECT uuid AS q_uuid, calllimit
        FROM mv_incoming_call_project
        WHERE partneruuid = %(partner_uuid)s AND removed = false
    ),
    operator_calls AS (
        SELECT
            COALESCE(cl_op.dst_id, cl_op.dst_abonent,
                     cl_rd.dst_id, cl_rd.dst_abonent) AS login,
            COUNT(*) AS handled_calls,
            ROUND(AVG(
                COALESCE(
                    EXTRACT(EPOCH FROM (cl_op.ended - cl_op.connected)),
                    EXTRACT(EPOCH FROM (cl_rd.ended - cl_rd.connected))
                )
            )::numeric, 1) AS avg_talk_sec,
            ROUND(SUM(
                COALESCE(
                    EXTRACT(EPOCH FROM (cl_op.ended - cl_op.connected)),
                    EXTRACT(EPOCH FROM (cl_rd.ended - cl_rd.connected))
                )
            )::numeric, 0) AS total_talk_sec,
            ROUND(AVG(que.unblocked_time_duration / 1000.0)::numeric, 1) AS avg_answer_sec,
            ROUND(100.0 * COUNT(*) FILTER (
                WHERE que.final_stage = 'operator'
                  AND que.unblocked_time_duration <= aq.calllimit * 1000
            ) / NULLIF(COUNT(*), 0)::numeric, 2) AS sl_percent
        FROM queued_calls_ms que
        JOIN active_queues aq ON aq.q_uuid = que.project_id
        LEFT JOIN call_legs cl_op ON cl_op.session_id = que.session_id
                                  AND cl_op.leg_id = que.next_leg_id
                                  AND que.final_stage = 'operator'
        LEFT JOIN call_legs cl_rd ON cl_rd.session_id = que.session_id
                                  AND cl_rd.leg_id = que.next_leg_id
                                  AND que.final_stage = 'redirect'
        WHERE que.enqueued_time >= %(begin_date)s::timestamp
          AND que.enqueued_time <  %(end_date)s::timestamp
          AND COALESCE(cl_op.dst_id, cl_op.dst_abonent,
                       cl_rd.dst_id, cl_rd.dst_abonent) IS NOT NULL
        GROUP BY COALESCE(cl_op.dst_id, cl_op.dst_abonent,
                          cl_rd.dst_id, cl_rd.dst_abonent)
    ),
    status_summary AS (
        SELECT
            sc.login,
            ROUND(SUM(sc.duration) FILTER (WHERE sc.status = 'normal')::numeric, 0) AS normal_sec
        FROM status_changes sc
        WHERE sc.entered >= %(begin_date)s::timestamp
          AND sc.entered <  %(end_date)s::timestamp
        GROUP BY sc.login
    )
    SELECT
        oc.login          AS login,
        em.title          AS employee_name,
        em.post           AS position,
        oc.handled_calls  AS handled_calls,
        oc.avg_talk_sec   AS avg_talk_sec,
        oc.total_talk_sec AS total_talk_sec,
        oc.avg_answer_sec AS avg_answer_sec,
        oc.sl_percent     AS sl_percent,
        GREATEST(0, COALESCE(ss.normal_sec, 0) - COALESCE(oc.total_talk_sec, 0)) AS idle_sec
    FROM operator_calls oc
    LEFT JOIN mv_employee em ON em.login = oc.login
    LEFT JOIN status_summary ss ON ss.login = oc.login
    ORDER BY oc.handled_calls DESC
    """
    return _execute(query, {"partner_uuid": partner_uuid, "begin_date": begin_date, "end_date": end_date}, overrides)


# ─── Статусы операторов ───────────────────────────────────────────────────────

def get_status_summary(partner_uuid: str, begin_date: str, end_date: str,
                       overrides: dict = None) -> list[dict]:
    query = """
    WITH active_queues AS (
        SELECT uuid AS q_uuid
        FROM mv_incoming_call_project
        WHERE partneruuid = %(partner_uuid)s AND removed = false
    ),
    active_logins AS (
        SELECT DISTINCT COALESCE(cl_op.dst_id, cl_op.dst_abonent,
                                 cl_rd.dst_id, cl_rd.dst_abonent) AS login
        FROM queued_calls_ms que
        JOIN active_queues aq ON aq.q_uuid = que.project_id
        LEFT JOIN call_legs cl_op ON cl_op.session_id = que.session_id
                                  AND cl_op.leg_id = que.next_leg_id
                                  AND que.final_stage = 'operator'
        LEFT JOIN call_legs cl_rd ON cl_rd.session_id = que.session_id
                                  AND cl_rd.leg_id = que.next_leg_id
                                  AND que.final_stage = 'redirect'
        WHERE que.enqueued_time >= %(begin_date)s::timestamp
          AND que.enqueued_time <  %(end_date)s::timestamp
          AND COALESCE(cl_op.dst_id, cl_op.dst_abonent,
                       cl_rd.dst_id, cl_rd.dst_abonent) IS NOT NULL
    )

    SELECT
        sc.login    AS login,
        sc.status   AS status,
        SUM(sc.duration) AS total_duration_sec,
        COUNT(*)    AS events_count
    FROM status_changes sc
    JOIN active_logins al ON al.login = sc.login
    WHERE sc.entered >= %(begin_date)s::timestamp
      AND sc.entered <  %(end_date)s::timestamp
    GROUP BY sc.login, sc.status
    ORDER BY sc.login, total_duration_sec DESC
    """
    return _execute(query, {"partner_uuid": partner_uuid, "begin_date": begin_date, "end_date": end_date}, overrides)


# ─── Сотрудники из Naumen ─────────────────────────────────────────────────────

def get_naumen_employees(partner_uuid: str, begin_date: str, end_date: str,
                         overrides: dict = None) -> list[dict]:
    query = """
    WITH active_queues AS (
        SELECT uuid AS q_uuid
        FROM mv_incoming_call_project
        WHERE partneruuid = %(partner_uuid)s AND removed = false
    ),
    handled AS (
        SELECT
            COALESCE(cl.dst_id, cl.dst_abonent) AS login,
            COUNT(*)                             AS handled_calls,
            COUNT(DISTINCT aq.q_uuid)            AS queues_count
        FROM queued_calls_ms que
        JOIN active_queues aq ON aq.q_uuid = que.project_id
        LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                               AND cl.leg_id = que.next_leg_id
        WHERE que.final_stage = 'operator'
          AND que.enqueued_time >= %(begin_date)s::timestamp
          AND que.enqueued_time <  %(end_date)s::timestamp
          AND COALESCE(cl.dst_id, cl.dst_abonent) IS NOT NULL
        GROUP BY COALESCE(cl.dst_id, cl.dst_abonent)
    )
    SELECT
        em.uuid           AS employee_uuid,
        em.login          AS login,
        em.title          AS employee_name,
        em.post           AS position,
        em.email          AS email,
        em.removed        AS is_removed,
        h.handled_calls   AS handled_calls,
        h.queues_count    AS queues_count
    FROM handled h
    JOIN mv_employee em ON em.login = h.login
    ORDER BY em.title
    """
    return _execute(query, {"partner_uuid": partner_uuid, "begin_date": begin_date, "end_date": end_date}, overrides)


def sync_employees_for_partner(partner_uuid: str, overrides: dict = None) -> list[dict]:
    """Get all operators who worked on a project in the last 365 days (for DB sync)."""
    from datetime import date, timedelta
    begin = (date.today() - timedelta(days=365)).isoformat()
    end = date.today().isoformat()
    return get_naumen_employees(partner_uuid, begin, end, overrides)


def get_active_logins_since(partner_uuid: str, cutoff_date: str, overrides: dict = None) -> set:
    """Логины операторов, имевших активность по проекту начиная с cutoff_date."""
    query = """
    SELECT DISTINCT COALESCE(cl.dst_id, cl.dst_abonent) AS login
    FROM queued_calls_ms que
    JOIN mv_incoming_call_project icp ON icp.uuid = que.project_id
    LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                           AND cl.leg_id = que.next_leg_id
    WHERE icp.partneruuid = %(partner_uuid)s
      AND icp.removed = false
      AND que.final_stage = 'operator'
      AND que.enqueued_time >= %(cutoff_date)s::timestamp
      AND COALESCE(cl.dst_id, cl.dst_abonent) IS NOT NULL
    """
    result = _execute(query, {"partner_uuid": partner_uuid, "cutoff_date": cutoff_date}, overrides)
    return {row["login"] for row in result}


def get_operator_sessions(logins: list, begin_date: str, end_date: str,
                          overrides: dict = None) -> list[dict]:
    """
    История сессий операторов по дням из status_changes.
    break_count — число переходов normal → non-normal (реальные "уходы с линии").
    """
    if not logins:
        return []
    query = """
    WITH raw AS (
        SELECT
            sc.login,
            DATE(sc.entered)                                               AS work_date,
            sc.status,
            sc.entered,
            sc.duration,
            sc.entered + make_interval(secs => sc.duration::float)        AS status_end,
            LAG(sc.status) OVER (
                PARTITION BY sc.login, DATE(sc.entered)
                ORDER BY sc.entered
            )                                                              AS prev_status
        FROM status_changes sc
        WHERE sc.login = ANY(%(logins)s)
          AND sc.entered >= %(begin_date)s::timestamp
          AND sc.entered <  %(end_date)s::timestamp
    )
    SELECT
        login                                                                     AS login,
        work_date                                                                 AS work_date,
        MIN(entered)                                                              AS first_login,
        MAX(entered) FILTER (WHERE status = 'normal')                            AS last_login,
        MAX(status_end)                                                           AS last_logout,
        ROUND(SUM(duration)::numeric, 0)                                         AS total_sec,
        ROUND(SUM(duration) FILTER (WHERE status = 'normal')::numeric, 0)        AS normal_sec,
        ROUND(SUM(duration) FILTER (WHERE status <> 'normal')::numeric, 0)       AS non_normal_sec,
        COUNT(*) FILTER (
            WHERE status <> 'normal'
              AND (prev_status = 'normal' OR prev_status IS NULL)
        )                                                                         AS break_count,
        STRING_AGG(DISTINCT status, ', ' ORDER BY status)                        AS statuses_seen
    FROM raw
    GROUP BY login, work_date
    ORDER BY login, work_date
    """
    return _execute(query, {"logins": logins, "begin_date": begin_date, "end_date": end_date}, overrides)


def get_operator_day_seconds(login: str, work_date: str, overrides: dict = None) -> float:
    """Суммарное время в статусах (в секундах) для оператора за указанную дату."""
    query = """
    SELECT COALESCE(SUM(duration), 0) AS total_sec
    FROM status_changes
    WHERE login = %(login)s
      AND entered >= %(work_date)s::timestamp
      AND entered <  (%(work_date)s::date + INTERVAL '1 day')::timestamp
    """
    result = _execute(query, {"login": login, "work_date": work_date}, overrides)
    return float(result[0]["total_sec"]) if result else 0.0


def test_connection(overrides: dict = None) -> dict:
    """Проверяет соединение с Naumen DB."""
    try:
        result = _execute("SELECT 1 AS ok", overrides=overrides)
        return {"ok": True, "message": "Соединение успешно"}
    except Exception as e:
        return {"ok": False, "message": str(e)}

"""
Read-only сервис для работы с PostgreSQL Naumen (nccrep).
Все запросы — только SELECT к разрешённым таблицам из ncc_schema.md.
"""
from typing import Optional, Any
import psycopg2
import psycopg2.extras
from app.core.config import settings


def _get_conn(overrides: Optional[dict] = None):
    """Открывает соединение с Naumen PostgreSQL.
    statement_timeout ограничивает любой отдельный запрос — без него медленный/
    зависший запрос держит соединение (и поток FastAPI) неограниченно долго и
    забирает свободные слоты у других вкладок/запросов."""
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


def _execute(query: str, params: dict = None, overrides: dict = None, timeout_ms: int = 20000) -> list[dict]:
    conn = _get_conn(overrides)
    try:
        with conn.cursor() as cur:
            # statement_timeout через SQL SET, а не startup-параметр options=-c —
            # перед nccrep стоит пулер соединений (PgBouncer), который отвечает
            # "unsupported startup parameter" на произвольные -c options.
            # SET не поддерживает параметризацию через execute(..., params) — timeout_ms
            # это int из кода (не пользовательский ввод), поэтому форматируем напрямую.
            cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
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
                      work_statuses: list = None, offline_statuses: list = None,
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
            ROUND(AVG(que.unblocked_time_duration / 1000.0) FILTER (
                WHERE que.final_stage = 'operator'
            )::numeric, 1) AS avg_answer_sec,
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
        -- idle_sec = время в статусах "На паузе" — той же классификации, что и в Онлайн/Сменах.
        -- "После звонка" дольше %(wrapup_stale_sec)s сек считается паузой, а не работой —
        -- иначе операторы зависают в нём вместо паузы и это не попадает в простой.
        SELECT
            sc.login,
            ROUND(SUM(COALESCE(sc.duration, 0)) FILTER (
                WHERE NOT (lower(sc.status) = ANY(%(work_statuses)s)
                       OR  lower(sc.status) = ANY(%(offline_statuses)s))
                   OR (lower(sc.status) = ANY(%(wrapup_statuses)s) AND sc.duration > %(wrapup_stale_sec)s)
            )::numeric, 0) AS idle_sec
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
        COALESCE(ss.idle_sec, 0) AS idle_sec
    FROM operator_calls oc
    LEFT JOIN mv_employee em ON em.login = oc.login
    LEFT JOIN status_summary ss ON ss.login = oc.login
    ORDER BY oc.handled_calls DESC
    """
    from app.services.status_classification import STANDARD_WORK, STANDARD_OFFLINE, WRAPUP_STATUSES, WRAPUP_STALE_SEC
    params = {
        "partner_uuid": partner_uuid,
        "begin_date": begin_date,
        "end_date": end_date,
        "work_statuses": work_statuses if work_statuses is not None else list(STANDARD_WORK),
        "offline_statuses": offline_statuses if offline_statuses is not None else list(STANDARD_OFFLINE),
        "wrapup_statuses": list(WRAPUP_STATUSES),
        "wrapup_stale_sec": WRAPUP_STALE_SEC,
    }
    return _execute(query, params, overrides)


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


def get_distinct_statuses_for_project(partner_uuid: str, overrides: dict = None,
                                       lookback_days: int = 3, sample_logins: int = 40) -> list[str]:
    """Все уникальные статусы, встречавшиеся у операторов проекта за последние
    lookback_days дней. Используется страницей "Статусы" для автообнаружения
    кастомных статусов (Custom1 и т.п.).

    lookback_days=3: статус, которым не воспользовался НИ ОДИН оператор за
    последние трое суток, в выборку не попадёт — но он либо уже сохранён в
    StatusConfig (и подмешивается в discover_statuses независимо от lookback,
    см. status_configs.py) и не пропадёт со страницы, либо реально не
    используется и не нужен. Пользователь может в любой момент нажать
    "Обновить из Naumen" — свежий запрос подтянет новые статусы, а уже
    настроенные останутся как есть (сопоставление по имени).

    Раньше JOIN со status_changes шёл по ВСЕМ логинам проекта за период — для
    крупных проектов (тысячи операторов, напр. X5) это означало сканирование
    статусной истории всех операторов за весь период просто чтобы собрать
    набор уникальных НАЗВАНИЙ статусов, которых физически не больше пары
    десятков. Палитра кастомных статусов (Custom1, Custom2 и т.п.) задаётся
    в Naumen на уровне проекта/группы, а не индивидуально для каждого
    оператора — поэтому достаточно посмотреть статусы небольшой выборки
    недавно активных операторов (sample_logins), а не всех. Это сокращает
    стоимость JOIN с O(операторы × дни) до O(sample_logins × дни) и делает
    запрос быстрым независимо от размера проекта, а не просто обрезает его
    по таймауту."""
    query = """
    WITH project_logins AS (
        SELECT COALESCE(cl.dst_id, cl.dst_abonent) AS login
        FROM queued_calls_ms que
        JOIN mv_incoming_call_project icp ON icp.uuid = que.project_id
        LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                               AND cl.leg_id = que.next_leg_id
        WHERE icp.partneruuid = %(partner_uuid)s
          AND icp.removed = false
          AND que.final_stage = 'operator'
          AND que.enqueued_time >= now() - make_interval(days => %(lookback_days)s)
          AND COALESCE(cl.dst_id, cl.dst_abonent) IS NOT NULL
        GROUP BY COALESCE(cl.dst_id, cl.dst_abonent)
        ORDER BY MAX(que.enqueued_time) DESC
        LIMIT %(sample_logins)s
    )
    SELECT DISTINCT sc.status AS status
    FROM status_changes sc
    JOIN project_logins pl ON pl.login = sc.login
    WHERE sc.entered >= now() - make_interval(days => %(lookback_days)s)
    ORDER BY sc.status
    """
    result = _execute(query, {
        "partner_uuid": partner_uuid,
        "lookback_days": lookback_days,
        "sample_logins": sample_logins,
    }, overrides)
    return [row["status"] for row in result]


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
    """Все операторы, работавшие на проекте за последние 90 дней, + флаги
    активности за 30 и 90 дней — за ОДИН проход по queued_calls_ms.

    Окно сужено с 365 до 90 дней: бизнес-правила синхронизации (см.
    employees.py _run_sync) больше не добавляют и не "воскрешают" сотрудников,
    не отвечавших дольше 3 месяцев, поэтому данные старше 90 дней для решений
    о синхронизации не нужны — а более узкое окно меньше нагружает Naumen и
    снижает риск statement_timeout на крупных проектах (X5, 300+ операторов)."""
    from datetime import date, timedelta
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
            COUNT(DISTINCT aq.q_uuid)            AS queues_count,
            MAX(que.enqueued_time)                AS last_activity
        FROM queued_calls_ms que
        JOIN active_queues aq ON aq.q_uuid = que.project_id
        LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                               AND cl.leg_id = que.next_leg_id
        WHERE que.final_stage = 'operator'
          AND que.enqueued_time >= now() - INTERVAL '90 days'
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
        h.queues_count    AS queues_count,
        h.last_activity   AS last_activity
    FROM handled h
    JOIN mv_employee em ON em.login = h.login
    ORDER BY em.title
    """
    # Полный скан queued_calls_ms за 90 дней для крупного проекта — может идти
    # дольше стандартных 20с; выполняется в фоновом потоке (см. employees.py
    # _run_sync), так что долгий запрос не блокирует HTTP-поток.
    rows = _execute(query, {"partner_uuid": partner_uuid}, overrides, timeout_ms=300000)
    cutoff_30 = date.today() - timedelta(days=30)
    cutoff_90 = date.today() - timedelta(days=90)
    for row in rows:
        last_activity = row.pop("last_activity")
        last_date = last_activity.date() if last_activity else None
        row["is_active_30d"] = bool(last_date and last_date >= cutoff_30)
        row["is_active_90d"] = bool(last_date and last_date >= cutoff_90)
    return rows


def get_operator_sessions(logins: list, begin_date: str, end_date: str,
                          work_statuses: list = None, offline_statuses: list = None,
                          overrides: dict = None) -> list[dict]:
    """
    История сессий операторов по дням из status_changes.
    Классификация статусов (work_statuses/offline_statuses) — та же, что в
    Онлайн-мониторинге: стандартные статусы + пользовательские настройки проекта
    (см. app.services.status_classification.build_status_sets).
    first_login  — первый вход в "рабочий" статус (начало смены).
    last_logout  — момент перехода в "офлайн" статус (конец смены).
    break_count  — число переходов из рабочего в не-рабочий/не-офлайн статус.
    """
    if not logins:
        return []
    from app.services.status_classification import STANDARD_WORK, STANDARD_OFFLINE, WRAPUP_STATUSES, WRAPUP_STALE_SEC
    work_statuses = work_statuses if work_statuses is not None else list(STANDARD_WORK)
    offline_statuses = offline_statuses if offline_statuses is not None else list(STANDARD_OFFLINE)
    query = """
    WITH events AS (
        -- Берём события из range; duration НЕ используем из VIEW —
        -- вычисляем сами через LEAD, чтобы не зависеть от глобально
        -- посчитанного поля, которое может охватывать дни вне диапазона.
        SELECT
            sc.login,
            sc.status,
            sc.entered,
            LEAD(sc.entered) OVER (
                PARTITION BY sc.login
                ORDER BY sc.entered
            )                                                             AS next_entered
        FROM status_changes sc
        WHERE sc.login = ANY(%(logins)s)
          AND sc.entered >= %(begin_date)s::timestamp
          AND sc.entered <  %(end_date)s::timestamp
    ),
    raw AS (
        SELECT
            login,
            DATE(entered)                                                 AS work_date,
            status,
            entered,
            -- duration = время до следующего события, но не дальше конца суток.
            -- Если следующего события нет в диапазоне (LEAD = NULL) — 0.
            GREATEST(0, LEAST(
                COALESCE(EXTRACT(EPOCH FROM (next_entered - entered)), 0),
                EXTRACT(EPOCH FROM (DATE_TRUNC('day', entered) + INTERVAL '1 day' - entered))
            ))                                                            AS duration,
            LAG(status) OVER (
                PARTITION BY login, DATE(entered)
                ORDER BY entered
            )                                                             AS prev_status
        FROM events
    ),
    classified AS (
        -- "После звонка" дольше wrapup_stale_sec — это пауза, а не работа
        -- (операторы зависают в нём вместо паузы), та же логика, что в Онлайн.
        SELECT
            *,
            (lower(status) = ANY(%(wrapup_statuses)s) AND duration > %(wrapup_stale_sec)s) AS is_stale_wrapup
        FROM raw
    ),
    bounds AS (
        -- Границы смены: первый вход в рабочий статус и последний выход в офлайн.
        -- "Вышли" внутри смены считаем только между ними (короткие обрывы связи
        -- в течение дня), а не время после ухода до конца суток.
        SELECT
            login, work_date,
            MIN(entered) FILTER (WHERE lower(status) = ANY(%(work_statuses)s))            AS shift_first_login,
            COALESCE(
                MAX(entered) FILTER (WHERE lower(status) = ANY(%(offline_statuses)s)),
                MAX(entered + make_interval(secs => duration::float))
            )                                                                              AS shift_last_logout
        FROM classified
        GROUP BY login, work_date
    )
    SELECT
        c.login                                                                            AS login,
        c.work_date                                                                        AS work_date,
        b.shift_first_login                                                                AS first_login,
        b.shift_last_logout                                                                AS last_logout,
        ROUND(SUM(c.duration)::numeric, 0)                                                 AS total_sec,
        ROUND(SUM(c.duration) FILTER (
            WHERE lower(c.status) = ANY(%(work_statuses)s) AND NOT c.is_stale_wrapup
        )::numeric, 0)                                                                     AS normal_sec,
        ROUND(SUM(c.duration) FILTER (
            WHERE NOT (lower(c.status) = ANY(%(work_statuses)s) OR lower(c.status) = ANY(%(offline_statuses)s))
               OR c.is_stale_wrapup
        )::numeric, 0)                                                                     AS non_normal_sec,
        ROUND(SUM(c.duration) FILTER (
            WHERE lower(c.status) = ANY(%(offline_statuses)s)
              AND c.entered >= b.shift_first_login AND c.entered <= b.shift_last_logout
        )::numeric, 0)                                                                     AS offline_sec,
        ROUND(SUM(c.duration) FILTER (
            WHERE NOT (lower(c.status) = ANY(%(offline_statuses)s))
        )::numeric, 0)                                                                     AS shift_sec,
        COUNT(*) FILTER (
            WHERE NOT (lower(c.status) = ANY(%(work_statuses)s) OR lower(c.status) = ANY(%(offline_statuses)s))
              AND (lower(c.prev_status) = ANY(%(work_statuses)s) OR c.prev_status IS NULL)
        )                                                                                   AS break_count,
        STRING_AGG(DISTINCT c.status, ', ' ORDER BY c.status)                              AS statuses_seen
    FROM classified c
    JOIN bounds b USING (login, work_date)
    GROUP BY c.login, c.work_date, b.shift_first_login, b.shift_last_logout
    ORDER BY c.login, c.work_date
    """
    params = {
        "logins": logins, "begin_date": begin_date, "end_date": end_date,
        "work_statuses": work_statuses, "offline_statuses": offline_statuses,
        "wrapup_statuses": list(WRAPUP_STATUSES), "wrapup_stale_sec": WRAPUP_STALE_SEC,
    }
    return _execute(query, params, overrides)


def get_operator_timeline(login: str, work_date: str, overrides: dict = None) -> list[dict]:
    """Все события статуса оператора за конкретный день (для визуальной линии)."""
    query = """
    WITH events AS (
        SELECT
            sc.login,
            sc.status,
            sc.entered,
            LEAD(sc.entered) OVER (
                PARTITION BY sc.login ORDER BY sc.entered
            ) AS next_entered
        FROM status_changes sc
        WHERE sc.login = %(login)s
          AND sc.entered >= %(work_date)s::timestamp
          AND sc.entered <  (%(work_date)s::date + INTERVAL '1 day')::timestamp
    )
    SELECT
        login,
        status,
        entered,
        GREATEST(0, LEAST(
            COALESCE(EXTRACT(EPOCH FROM (next_entered - entered)), 0),
            EXTRACT(EPOCH FROM (DATE_TRUNC('day', entered) + INTERVAL '1 day' - entered))
        )) AS duration_sec
    FROM events
    ORDER BY entered
    """
    return _execute(query, {"login": login, "work_date": work_date}, overrides)


def get_operator_timeline_window(login: str, hours: int, overrides: dict = None) -> list[dict]:
    """Все события статуса оператора за скользящее окно [сейчас - hours, сейчас]
    (для Онлайн-мониторинга — там нужны последние N часов, а не календарный день).
    Сегменты обрезаются по границам окна, как и в get_operator_timeline по дню."""
    query = """
    WITH bound AS (
        SELECT NOW() AS window_end, NOW() - (%(hours)s || ' hours')::interval AS window_start
    ),
    events AS (
        SELECT
            sc.login,
            sc.status,
            sc.entered,
            LEAD(sc.entered) OVER (
                PARTITION BY sc.login ORDER BY sc.entered
            ) AS next_entered
        FROM status_changes sc, bound
        WHERE sc.login = %(login)s
          AND sc.entered >= bound.window_start - INTERVAL '1 day'
          AND sc.entered <= bound.window_end
    )
    SELECT
        e.login,
        e.status,
        GREATEST(e.entered, bound.window_start)                                            AS entered,
        EXTRACT(EPOCH FROM (
            LEAST(COALESCE(e.next_entered, bound.window_end), bound.window_end)
            - GREATEST(e.entered, bound.window_start)
        ))                                                                                  AS duration_sec
    FROM events e, bound
    WHERE COALESCE(e.next_entered, bound.window_end) > bound.window_start
      AND e.entered < bound.window_end
    ORDER BY entered
    """
    return _execute(query, {"login": login, "hours": hours}, overrides)


def get_actual_operators_by_hour(logins: list, begin_date: str, end_date: str,
                                  overrides: dict = None) -> list[dict]:
    """Среднее фактическое число операторов не-offline по часам суток за период."""
    if not logins:
        return []
    query = """
    WITH active_events AS (
        SELECT
            login,
            DATE(entered)             AS work_date,
            EXTRACT(HOUR FROM entered)::int AS hour_num
        FROM status_changes
        WHERE login = ANY(%(logins)s)
          AND status != 'offline'
          AND entered >= %(begin_date)s::timestamp
          AND entered <  %(end_date)s::timestamp
    ),
    by_day_hour AS (
        SELECT
            work_date,
            hour_num,
            COUNT(DISTINCT login) AS operator_count
        FROM active_events
        GROUP BY work_date, hour_num
    )
    SELECT
        hour_num,
        ROUND(AVG(operator_count)::numeric, 1) AS avg_operators
    FROM by_day_hour
    GROUP BY hour_num
    ORDER BY hour_num
    """
    return _execute(query, {"logins": logins, "begin_date": begin_date, "end_date": end_date}, overrides)


def get_current_operators_for_project(partner_uuid: str, overrides: dict = None) -> list[dict]:
    """Current operator statuses for a project.
    Finds active logins via queued_calls_ms (last 7 days) then gets latest
    status from status_changes (last 48 h) — fast, no full-table scan.
    """
    query = """
    WITH project_logins AS (
        SELECT DISTINCT COALESCE(cl.dst_id, cl.dst_abonent) AS login
        FROM queued_calls_ms que
        JOIN mv_incoming_call_project icp ON icp.uuid = que.project_id
        LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                               AND cl.leg_id = que.next_leg_id
        WHERE icp.partneruuid = %(partner_uuid)s
          AND icp.removed = false
          AND que.final_stage = 'operator'
          AND que.enqueued_time >= NOW() - INTERVAL '7 days'
          AND COALESCE(cl.dst_id, cl.dst_abonent) IS NOT NULL
    ),
    latest_status AS (
        SELECT DISTINCT ON (sc.login)
            sc.login,
            sc.status,
            sc.entered
        FROM status_changes sc
        JOIN project_logins pl ON pl.login = sc.login
        WHERE sc.entered >= NOW() - INTERVAL '48 hours'
        ORDER BY sc.login, sc.entered DESC
    )
    SELECT
        ls.login         AS login,
        ls.status        AS status,
        ls.entered       AS entered,
        em.title         AS employee_name
    FROM latest_status ls
    LEFT JOIN mv_employee em ON em.login = ls.login
    ORDER BY ls.status, ls.entered DESC
    """
    return _execute(query, {"partner_uuid": partner_uuid}, overrides)


def get_current_online_operators(logins: list, overrides: dict = None) -> list[dict]:
    """Latest operator status, filtered by login list and last 48 h."""
    if not logins:
        return []
    query = """
    SELECT DISTINCT ON (login)
        login,
        status,
        entered
    FROM status_changes
    WHERE login = ANY(%(logins)s)
      AND entered >= NOW() - INTERVAL '48 hours'
    ORDER BY login, entered DESC
    """
    return _execute(query, {"logins": logins}, overrides)


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

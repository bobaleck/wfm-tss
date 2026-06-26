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
            rows = [dict(row) for row in cur.fetchall()]
        # Явно завершаем транзакцию: psycopg2 по умолчанию autocommit=False, и без
        # commit/rollback соединение возвращается в PgBouncer «idle in transaction»,
        # удерживая серверный слот — при опросе/нескольких вкладках это исчерпывает
        # пул PgBouncer, и Naumen становится «недоступен» вообще (даже для теста).
        conn.commit()
        return rows
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


def _execute_multi(queries: list, overrides: dict = None, timeout_ms: int = 20000) -> list:
    """Выполняет несколько SELECT'ов на ОДНОМ соединении (список (query, params)).
    Сокращает число открытий соединений к Naumen для много-запросных отчётов
    (исходящая сводка/статистика) — меньше нагрузки на PgBouncer."""
    conn = _get_conn(overrides)
    try:
        out = []
        with conn.cursor() as cur:
            cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
            for q, params in queries:
                cur.execute(q, params or {})
                out.append([dict(row) for row in cur.fetchall()])
        conn.commit()
        return out
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
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


def get_recent_stats(partner_uuid: str, window_min: int, overrides: dict = None) -> dict:
    """Статистика за последние window_min минут: по очередям (Поступило/Обработано/
    Потеряно/SL/AHT) и по (оператор, очередь) — для раздела «Мониторинг → Статистика»
    с ползунком окна. Окно произвольное (минуты), т.к. считаем прямо по звонкам."""
    q_queue = """
    SELECT
        icp.title AS queue_name,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE que.final_stage = 'operator') AS handled,
        COUNT(*) FILTER (WHERE COALESCE(que.final_stage,'') <> 'operator') AS lost,
        ROUND(AVG(EXTRACT(EPOCH FROM (cl.ended - cl.connected))) FILTER (
            WHERE que.final_stage = 'operator' AND cl.connected IS NOT NULL AND cl.ended IS NOT NULL
        )::numeric, 1) AS aht,
        CASE WHEN MAX(icp.calllimit) > 0 THEN ROUND(
            100.0 * COUNT(*) FILTER (
                WHERE que.final_stage = 'operator' AND que.unblocked_time_duration <= icp.calllimit * 1000
            ) / NULLIF(COUNT(*), 0), 2)
        ELSE NULL END AS sl
    FROM queued_calls_ms que
    JOIN mv_incoming_call_project icp ON icp.uuid = que.project_id
    LEFT JOIN call_legs cl ON cl.session_id = que.session_id AND cl.leg_id = que.next_leg_id
    WHERE icp.partneruuid = %(p)s AND icp.removed = false
      AND que.enqueued_time >= NOW() - make_interval(mins => %(w)s)
    GROUP BY icp.title
    ORDER BY total DESC
    """
    q_op = """
    WITH aq AS (
        SELECT uuid AS q_uuid, title AS queue_name, calllimit
        FROM mv_incoming_call_project
        WHERE partneruuid = %(p)s AND removed = false
    )
    SELECT
        aq.queue_name AS queue_name,
        COALESCE(cl.dst_id, cl.dst_abonent) AS login,
        em.title AS employee_name,
        COUNT(*) AS handled,
        ROUND(AVG(EXTRACT(EPOCH FROM (cl.ended - cl.connected)))::numeric, 1) AS aht,
        ROUND(100.0 * COUNT(*) FILTER (
            WHERE que.unblocked_time_duration <= aq.calllimit * 1000
        ) / NULLIF(COUNT(*), 0)::numeric, 2) AS sl
    FROM queued_calls_ms que
    JOIN aq ON aq.q_uuid = que.project_id
    LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                           AND cl.leg_id = que.next_leg_id AND que.final_stage = 'operator'
    LEFT JOIN mv_employee em ON em.login = COALESCE(cl.dst_id, cl.dst_abonent)
    WHERE que.final_stage = 'operator'
      AND que.enqueued_time >= NOW() - make_interval(mins => %(w)s)
      AND COALESCE(cl.dst_id, cl.dst_abonent) IS NOT NULL
    GROUP BY aq.queue_name, COALESCE(cl.dst_id, cl.dst_abonent), em.title
    ORDER BY handled DESC
    """
    by_queue = _execute(q_queue, {"p": partner_uuid, "w": window_min}, overrides)
    by_op_queue = _execute(q_op, {"p": partner_uuid, "w": window_min}, overrides)
    return {"by_queue": by_queue, "by_operator_queue": by_op_queue}


def get_operator_load_by_queue(partner_uuid: str, begin_date: str, end_date: str,
                               overrides: dict = None) -> list[dict]:
    """Нагрузка операторов в разрезе ОЧЕРЕДЕЙ: на каждую (очередь, оператор) —
    обработанные звонки, AHT, общее время разговора, ср. ответ, SL. Позволяет
    показать операторов по очередям и, наоборот, очереди по оператору."""
    query = """
    WITH active_queues AS (
        SELECT uuid AS q_uuid, title AS queue_name, calllimit
        FROM mv_incoming_call_project
        WHERE partneruuid = %(partner_uuid)s AND removed = false
    ),
    operator_calls AS (
        SELECT
            aq.queue_name AS queue_name,
            COALESCE(cl_op.dst_id, cl_op.dst_abonent,
                     cl_rd.dst_id, cl_rd.dst_abonent) AS login,
            COUNT(*) AS handled_calls,
            ROUND(AVG(COALESCE(
                EXTRACT(EPOCH FROM (cl_op.ended - cl_op.connected)),
                EXTRACT(EPOCH FROM (cl_rd.ended - cl_rd.connected))
            ))::numeric, 1) AS avg_talk_sec,
            ROUND(SUM(COALESCE(
                EXTRACT(EPOCH FROM (cl_op.ended - cl_op.connected)),
                EXTRACT(EPOCH FROM (cl_rd.ended - cl_rd.connected))
            ))::numeric, 0) AS total_talk_sec,
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
        GROUP BY aq.queue_name, COALESCE(cl_op.dst_id, cl_op.dst_abonent,
                                         cl_rd.dst_id, cl_rd.dst_abonent)
    )
    SELECT
        oc.queue_name     AS queue_name,
        oc.login          AS login,
        em.title          AS employee_name,
        em.post           AS position,
        oc.handled_calls  AS handled_calls,
        oc.avg_talk_sec   AS avg_talk_sec,
        oc.total_talk_sec AS total_talk_sec,
        oc.avg_answer_sec AS avg_answer_sec,
        oc.sl_percent     AS sl_percent
    FROM operator_calls oc
    LEFT JOIN mv_employee em ON em.login = oc.login
    ORDER BY oc.queue_name, oc.handled_calls DESC
    """
    return _execute(query, {"partner_uuid": partner_uuid, "begin_date": begin_date, "end_date": end_date}, overrides)


def get_actual_operators_union(partner_uuid: str, begin_date: str, end_date: str,
                               queues: list = None, overrides: dict = None) -> list[dict]:
    """Среднее фактическое число операторов по часам суток, считая ФАКТ по
    очередям через обработку звонков. Если передан список queues — берём только
    их, но оператор, работавший в нескольких выбранных очередях, считается ОДИН
    раз (COUNT(DISTINCT login) на (день,час) поверх всех выбранных очередей =
    union). Это исправляет двойной счёт мультиочередных операторов."""
    queue_filter = "AND icp.title = ANY(%(queues)s)" if queues else ""
    query = f"""
    WITH active AS (
        SELECT
            DATE(que.enqueued_time)                       AS d,
            EXTRACT(HOUR FROM que.enqueued_time)::int      AS hour_num,
            COALESCE(cl.dst_id, cl.dst_abonent)            AS login
        FROM queued_calls_ms que
        JOIN mv_incoming_call_project icp ON icp.uuid = que.project_id
        LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                               AND cl.leg_id = que.next_leg_id
        WHERE icp.partneruuid = %(partner_uuid)s
          AND icp.removed = false
          AND que.final_stage = 'operator'
          AND que.enqueued_time >= %(begin_date)s::timestamp
          AND que.enqueued_time <  %(end_date)s::timestamp
          AND COALESCE(cl.dst_id, cl.dst_abonent) IS NOT NULL
          {queue_filter}
    ),
    by_day_hour AS (
        SELECT d, hour_num, COUNT(DISTINCT login) AS cnt
        FROM active GROUP BY d, hour_num
    )
    SELECT hour_num, ROUND(AVG(cnt)::numeric, 1) AS avg_operators
    FROM by_day_hour GROUP BY hour_num ORDER BY hour_num
    """
    params = {"partner_uuid": partner_uuid, "begin_date": begin_date, "end_date": end_date}
    if queues:
        params["queues"] = queues
    return _execute(query, params, overrides)


def get_actual_operators_by_queue(partner_uuid: str, begin_date: str, end_date: str,
                                  overrides: dict = None) -> list[dict]:
    """Среднее фактическое число операторов по (очередь, час). Для разреза по
    очередям. Union по выбранным очередям считать отдельно (get_actual_operators_union)."""
    query = """
    WITH active AS (
        SELECT
            icp.title                                      AS queue_name,
            DATE(que.enqueued_time)                        AS d,
            EXTRACT(HOUR FROM que.enqueued_time)::int       AS hour_num,
            COALESCE(cl.dst_id, cl.dst_abonent)            AS login
        FROM queued_calls_ms que
        JOIN mv_incoming_call_project icp ON icp.uuid = que.project_id
        LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                               AND cl.leg_id = que.next_leg_id
        WHERE icp.partneruuid = %(partner_uuid)s
          AND icp.removed = false
          AND que.final_stage = 'operator'
          AND que.enqueued_time >= %(begin_date)s::timestamp
          AND que.enqueued_time <  %(end_date)s::timestamp
          AND COALESCE(cl.dst_id, cl.dst_abonent) IS NOT NULL
    ),
    by_q_day_hour AS (
        SELECT queue_name, d, hour_num, COUNT(DISTINCT login) AS cnt
        FROM active GROUP BY queue_name, d, hour_num
    )
    SELECT queue_name, hour_num, ROUND(AVG(cnt)::numeric, 1) AS avg_operators
    FROM by_q_day_hour GROUP BY queue_name, hour_num ORDER BY queue_name, hour_num
    """
    return _execute(query, {"partner_uuid": partner_uuid, "begin_date": begin_date, "end_date": end_date}, overrides)


def get_current_operators_for_project(partner_uuid: str, overrides: dict = None,
                                      work_statuses: list = None, offline_statuses: list = None) -> list[dict]:
    """Текущие статусы операторов проекта. `entered` — НЕ время последней
    «сырой» смены статуса, а начало текущего непрерывного отрезка той же
    КЛАССИФИКАЦИИ (в линии / на паузе / офлайн). Так «в линии с HH:MM»
    совпадает с временной шкалой (которая красит по группам), а не показывает
    время последнего под-перехода внутри той же группы.
    """
    from app.services.status_classification import STANDARD_WORK, STANDARD_OFFLINE
    work = work_statuses if work_statuses is not None else list(STANDARD_WORK)
    offline = offline_statuses if offline_statuses is not None else list(STANDARD_OFFLINE)
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
    ev AS (
        SELECT
            sc.login, sc.status, sc.entered,
            CASE WHEN lower(sc.status) = ANY(%(work)s)    THEN 'work'
                 WHEN lower(sc.status) = ANY(%(offline)s) THEN 'offline'
                 ELSE 'pause' END AS grp
        FROM status_changes sc
        JOIN project_logins pl ON pl.login = sc.login
        WHERE sc.entered >= NOW() - INTERVAL '48 hours'
    ),
    marked AS (
        SELECT login, status, entered, grp,
               LAG(grp) OVER (PARTITION BY login ORDER BY entered) AS prev_grp
        FROM ev
    ),
    islands AS (
        SELECT login, status, entered, grp,
               SUM(CASE WHEN grp IS DISTINCT FROM prev_grp THEN 1 ELSE 0 END)
                   OVER (PARTITION BY login ORDER BY entered) AS island
        FROM marked
    ),
    runs AS (
        SELECT login, grp, island,
               MIN(entered) AS run_started,
               MAX(entered) AS last_entered,
               (ARRAY_AGG(status ORDER BY entered DESC))[1] AS last_status
        FROM islands
        GROUP BY login, grp, island
    ),
    latest AS (
        SELECT DISTINCT ON (login)
            login, last_status AS status, run_started AS entered
        FROM runs
        ORDER BY login, last_entered DESC
    )
    SELECT
        l.login          AS login,
        l.status         AS status,
        l.entered        AS entered,
        em.title         AS employee_name
    FROM latest l
    LEFT JOIN mv_employee em ON em.login = l.login
    ORDER BY l.status, l.entered DESC
    """
    return _execute(query, {"partner_uuid": partner_uuid, "work": work, "offline": offline}, overrides)


def get_operator_queues_map(partner_uuid: str, days: int = 7, overrides: dict = None) -> dict:
    """Для каждого оператора проекта — очереди, в которых он недавно (за `days`
    суток) обрабатывал звонки, упорядоченные по числу звонков (наиболее
    «своя» очередь — первой). Используется в Мониторинге, чтобы рядом с ФИО
    показать очередь(и), в которых оператор стоит / на паузе / с которой вышел.
    Явной привязки «оператор ⇄ очередь» в схеме нет — принадлежность очереди
    выводим из фактически обработанных звонков (тот же принцип, что и членство
    в проекте)."""
    query = """
    SELECT
        COALESCE(cl.dst_id, cl.dst_abonent) AS login,
        icp.title                           AS queue_name,
        COUNT(*)                            AS cnt
    FROM queued_calls_ms que
    JOIN mv_incoming_call_project icp ON icp.uuid = que.project_id
    LEFT JOIN call_legs cl ON cl.session_id = que.session_id
                           AND cl.leg_id = que.next_leg_id
    WHERE icp.partneruuid = %(p)s
      AND icp.removed = false
      AND que.final_stage = 'operator'
      AND que.enqueued_time >= NOW() - make_interval(days => %(d)s)
      AND COALESCE(cl.dst_id, cl.dst_abonent) IS NOT NULL
    GROUP BY COALESCE(cl.dst_id, cl.dst_abonent), icp.title
    ORDER BY login, cnt DESC
    """
    rows = _execute(query, {"p": partner_uuid, "d": days}, overrides)
    result: dict = {}
    for r in rows:
        result.setdefault(r["login"], []).append(r["queue_name"])
    return result


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


def get_operator_outbound_projects_map(partner_uuid: str, days: int = 7, overrides: dict = None) -> dict:
    """Для каждого оператора — исходящие проекты (линии), по которым он недавно
    (за `days` суток) делал попытки. Аналог get_operator_queues_map, но для
    исходящих (источник — detail_outbound_sessions_ms)."""
    query = """
    SELECT d.login AS login, ocp.title AS queue_name, COUNT(*) AS cnt
    FROM detail_outbound_sessions_ms d
    JOIN mv_outcoming_call_project ocp ON ocp.uuid = d.project_id AND ocp.removed = false
    WHERE ocp.partneruuid = %(p)s
      AND d.attempt_start >= NOW() - make_interval(days => %(d)s)
      AND d.login IS NOT NULL
    GROUP BY d.login, ocp.title
    ORDER BY login, cnt DESC
    """
    rows = _execute(query, {"p": partner_uuid, "d": days}, overrides)
    result: dict = {}
    for r in rows:
        result.setdefault(r["login"], []).append(r["queue_name"])
    return result


def get_current_operators_outbound(partner_uuid: str, overrides: dict = None,
                                   work_statuses: list = None, offline_statuses: list = None) -> list[dict]:
    """Текущие статусы операторов ИСХОДЯЩИХ линий проекта (в линии / на паузе /
    вышел). Состав операторов — логины из detail_outbound_sessions_ms за 7 дней
    (исходящие проекты партнёра). Статус — как в get_current_operators_for_project:
    `entered` = начало текущего непрерывного отрезка той же классификации."""
    from app.services.status_classification import STANDARD_WORK, STANDARD_OFFLINE
    work = work_statuses if work_statuses is not None else list(STANDARD_WORK)
    offline = offline_statuses if offline_statuses is not None else list(STANDARD_OFFLINE)
    query = """
    WITH op_logins AS (
        SELECT DISTINCT d.login AS login
        FROM detail_outbound_sessions_ms d
        JOIN mv_outcoming_call_project ocp ON ocp.uuid = d.project_id AND ocp.removed = false
        WHERE ocp.partneruuid = %(partner_uuid)s
          AND d.attempt_start >= NOW() - INTERVAL '7 days'
          AND d.login IS NOT NULL
    ),
    ev AS (
        SELECT
            sc.login, sc.status, sc.entered,
            CASE WHEN lower(sc.status) = ANY(%(work)s)    THEN 'work'
                 WHEN lower(sc.status) = ANY(%(offline)s) THEN 'offline'
                 ELSE 'pause' END AS grp
        FROM status_changes sc
        JOIN op_logins ol ON ol.login = sc.login
        WHERE sc.entered >= NOW() - INTERVAL '48 hours'
    ),
    marked AS (
        SELECT login, status, entered, grp,
               LAG(grp) OVER (PARTITION BY login ORDER BY entered) AS prev_grp
        FROM ev
    ),
    islands AS (
        SELECT login, status, entered, grp,
               SUM(CASE WHEN grp IS DISTINCT FROM prev_grp THEN 1 ELSE 0 END)
                   OVER (PARTITION BY login ORDER BY entered) AS island
        FROM marked
    ),
    runs AS (
        SELECT login, grp, island,
               MIN(entered) AS run_started,
               MAX(entered) AS last_entered,
               (ARRAY_AGG(status ORDER BY entered DESC))[1] AS last_status
        FROM islands
        GROUP BY login, grp, island
    ),
    latest AS (
        SELECT DISTINCT ON (login)
            login, last_status AS status, run_started AS entered
        FROM runs
        ORDER BY login, last_entered DESC
    )
    SELECT l.login AS login, l.status AS status, l.entered AS entered, em.title AS employee_name
    FROM latest l
    LEFT JOIN mv_employee em ON em.login = l.login
    ORDER BY l.status, l.entered DESC
    """
    return _execute(query, {"partner_uuid": partner_uuid, "work": work, "offline": offline}, overrides)


def get_recent_stats_outbound(partner_uuid: str, window_min: int, overrides: dict = None) -> dict:
    """Live-статистика исходящего обзвона за последние window_min минут: по
    операторам (попытки/контакты/ср.разговор) и по результату попыток. Контакт =
    реальный разговор speaking_time > 10 c. Времена dosm — в МС."""
    q_op = """
    SELECT
        d.login AS login,
        em.title AS employee_name,
        COUNT(*) AS attempts,
        COUNT(*) FILTER (WHERE d.speaking_time > 10000) AS contacts,
        ROUND(AVG(d.speaking_time / 1000.0) FILTER (WHERE d.speaking_time > 0)::numeric, 1) AS avg_talk_sec
    FROM detail_outbound_sessions_ms d
    JOIN mv_outcoming_call_project ocp ON ocp.uuid = d.project_id AND ocp.removed = false
    LEFT JOIN mv_employee em ON em.login = d.login
    WHERE ocp.partneruuid = %(p)s
      AND d.attempt_start >= NOW() - make_interval(mins => %(w)s)
      AND d.login IS NOT NULL
    GROUP BY d.login, em.title
    ORDER BY attempts DESC
    """
    q_res = """
    SELECT COALESCE(d.attempt_result, '—') AS result, COUNT(*) AS cnt,
           COUNT(*) FILTER (WHERE d.speaking_time > 10000) AS contacts
    FROM detail_outbound_sessions_ms d
    JOIN mv_outcoming_call_project ocp ON ocp.uuid = d.project_id AND ocp.removed = false
    WHERE ocp.partneruuid = %(p)s
      AND d.attempt_start >= NOW() - make_interval(mins => %(w)s)
    GROUP BY d.attempt_result
    ORDER BY cnt DESC
    """
    params = {"p": partner_uuid, "w": window_min}
    res = _execute_multi([(q_op, params), (q_res, params)], overrides)
    return {"by_operator": res[0], "by_result": res[1]}


def get_outbound_projects(partner_uuid: str, overrides: dict = None) -> list[dict]:
    """Список исходящих проектов (подпроектов/«очередей» обзвона) партнёра."""
    query = """
    SELECT uuid AS project_uuid, title AS name, datachannel AS channel, state AS status
    FROM mv_outcoming_call_project
    WHERE partneruuid = %(p)s AND removed = false
    ORDER BY title
    """
    return _execute(query, {"p": partner_uuid}, overrides)


def get_outbound_summary(partner_uuid: str, begin_date: str, end_date: str,
                         project_ids: list = None, overrides: dict = None) -> dict:
    """Сводка исходящего обзвона за период (костяк — detail_outbound_sessions_ms,
    проект — через mv_outcoming_call_project.partneruuid). Канон (WFM_instruction_pack):
    - времена dosm — в МС (÷1000 → сек);
    - контакт = реальный разговор speaking_time > 10 c;
    - бизнес-результат — по ПОСЛЕДНЕЙ попытке кейса (1 кейс = 1 итог).
    project_ids — фильтр по конкретным исходящим подпроектам (если задан)."""
    flt = "AND d.project_id = ANY(%(pids)s)" if project_ids else ""
    base = f"""
        FROM detail_outbound_sessions_ms d
        JOIN mv_outcoming_call_project ocp ON ocp.uuid = d.project_id AND ocp.removed = false
        WHERE ocp.partneruuid = %(p)s
          AND d.attempt_start >= %(begin)s::timestamp
          AND d.attempt_start <  %(end)s::timestamp
          {flt}
    """
    q_totals = f"""
    SELECT
        COUNT(*)                                            AS attempts,
        COUNT(DISTINCT d.case_uuid)                         AS cases,
        COUNT(*) FILTER (WHERE d.speaking_time > 10000)     AS contacts,
        ROUND(100.0 * COUNT(*) FILTER (WHERE d.speaking_time > 10000)
              / NULLIF(COUNT(*), 0), 1)                     AS contact_rate,
        ROUND(AVG(d.speaking_time / 1000.0) FILTER (WHERE d.speaking_time > 0)::numeric, 1) AS avg_talk_sec,
        ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT d.case_uuid), 0), 2) AS attempts_per_case
    {base}
    """
    q_by_result = f"""
    WITH last_att AS (
        SELECT DISTINCT ON (d.case_uuid) d.case_uuid, d.attempt_result
        FROM detail_outbound_sessions_ms d
        JOIN mv_outcoming_call_project ocp ON ocp.uuid = d.project_id AND ocp.removed = false
        WHERE ocp.partneruuid = %(p)s
          AND d.attempt_start >= %(begin)s::timestamp
          AND d.attempt_start <  %(end)s::timestamp
          AND d.case_uuid IS NOT NULL
          {flt}
        ORDER BY d.case_uuid, d.attempt_start DESC
    )
    SELECT COALESCE(attempt_result, '—') AS result, COUNT(*) AS cnt
    FROM last_att GROUP BY attempt_result ORDER BY cnt DESC
    """
    q_by_day = f"""
    SELECT DATE(d.attempt_start)                            AS day,
           COUNT(*)                                         AS attempts,
           COUNT(*) FILTER (WHERE d.speaking_time > 10000)  AS contacts
    {base}
    GROUP BY DATE(d.attempt_start)
    ORDER BY day
    """
    q_by_project = f"""
    SELECT ocp.title                                        AS name,
           d.project_id                                     AS project_uuid,
           COUNT(*)                                         AS attempts,
           COUNT(DISTINCT d.case_uuid)                      AS cases,
           COUNT(*) FILTER (WHERE d.speaking_time > 10000)  AS contacts,
           ROUND(100.0 * COUNT(*) FILTER (WHERE d.speaking_time > 10000)
                 / NULLIF(COUNT(*), 0), 1)                  AS contact_rate
    {base}
    GROUP BY ocp.title, d.project_id
    ORDER BY attempts DESC
    """
    params = {"p": partner_uuid, "begin": begin_date, "end": end_date}
    if project_ids:
        params["pids"] = project_ids
    totals, by_result, by_day, by_project = _execute_multi(
        [(q_totals, params), (q_by_result, params), (q_by_day, params), (q_by_project, params)], overrides,
    )
    return {
        "totals": totals[0] if totals else {},
        "by_result": by_result,
        "by_day": [{"day": str(r["day"]), "attempts": r["attempts"], "contacts": r["contacts"]} for r in by_day],
        "by_project": by_project,
    }


def get_outbound_operator_load(partner_uuid: str, begin_date: str, end_date: str,
                               project_ids: list = None, overrides: dict = None) -> list[dict]:
    """Нагрузка операторов на обзвоне за период: попытки, контакты, contact rate,
    ср. разговор, кейсы, попыток на кейс. project_ids — фильтр по подпроектам."""
    flt = "AND d.project_id = ANY(%(pids)s)" if project_ids else ""
    query = f"""
    SELECT
        d.login AS login,
        em.title AS employee_name,
        COUNT(*) AS attempts,
        COUNT(*) FILTER (WHERE d.speaking_time > 10000) AS contacts,
        ROUND(100.0 * COUNT(*) FILTER (WHERE d.speaking_time > 10000) / NULLIF(COUNT(*), 0), 1) AS contact_rate,
        ROUND(AVG(d.speaking_time / 1000.0) FILTER (WHERE d.speaking_time > 0)::numeric, 1) AS avg_talk_sec,
        COUNT(DISTINCT d.case_uuid) AS cases,
        ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT d.case_uuid), 0), 2) AS attempts_per_case
    FROM detail_outbound_sessions_ms d
    JOIN mv_outcoming_call_project ocp ON ocp.uuid = d.project_id AND ocp.removed = false
    LEFT JOIN mv_employee em ON em.login = d.login
    WHERE ocp.partneruuid = %(p)s
      AND d.attempt_start >= %(begin)s::timestamp
      AND d.attempt_start <  %(end)s::timestamp
      AND d.login IS NOT NULL
      {flt}
    GROUP BY d.login, em.title
    ORDER BY attempts DESC
    """
    params = {"p": partner_uuid, "begin": begin_date, "end": end_date}
    if project_ids:
        params["pids"] = project_ids
    return _execute(query, params, overrides)


def get_outbound_load_by_hour(partner_uuid: str, begin_date: str, end_date: str,
                              project_ids: list = None, overrides: dict = None) -> list[dict]:
    """Нагрузка обзвона по часам суток за период (когда звонят): попытки и контакты.
    project_ids — фильтр по подпроектам."""
    flt = "AND d.project_id = ANY(%(pids)s)" if project_ids else ""
    query = f"""
    SELECT EXTRACT(HOUR FROM d.attempt_start)::int          AS hour_num,
           COUNT(*)                                         AS attempts,
           COUNT(*) FILTER (WHERE d.speaking_time > 10000)  AS contacts
    FROM detail_outbound_sessions_ms d
    JOIN mv_outcoming_call_project ocp ON ocp.uuid = d.project_id AND ocp.removed = false
    WHERE ocp.partneruuid = %(p)s
      AND d.attempt_start >= %(begin)s::timestamp
      AND d.attempt_start <  %(end)s::timestamp
      {flt}
    GROUP BY hour_num
    ORDER BY hour_num
    """
    params = {"p": partner_uuid, "begin": begin_date, "end": end_date}
    if project_ids:
        params["pids"] = project_ids
    return _execute(query, params, overrides)


def test_connection(overrides: dict = None) -> dict:
    """Проверяет соединение с Naumen DB."""
    try:
        result = _execute("SELECT 1 AS ok", overrides=overrides)
        return {"ok": True, "message": "Соединение успешно"}
    except Exception as e:
        return {"ok": False, "message": str(e)}

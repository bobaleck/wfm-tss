from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

engine = create_engine(
    settings.WFM_DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.WFM_DATABASE_URL else {},
    # Дефолтный QueuePool (5 + overflow 10 = 15) исчерпывается при нескольких открытых вкладках,
    # которые параллельно опрашивают разные ручки, пока часть запросов держит сессию во время
    # медленных синхронных вызовов в Naumen. Когда пул кончается, падает даже get_current_user —
    # то есть авторизация на любой ручке, что выглядит как полный отказ системы.
    pool_size=20,
    max_overflow=40,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _sqlite_migrate(db_engine):
    """Add missing columns to existing SQLite databases on startup."""
    migrations = [
        ("employees", "employment_status TEXT DEFAULT 'new'"),
        ("employees", "preferred_schedule TEXT"),
        ("employees", "added_manually INTEGER DEFAULT 0"),
        ("teams", "leader_id INTEGER REFERENCES employees(id)"),
        ("teams", "leader_user_id INTEGER REFERENCES users(id)"),
        ("shifts", "actual_start_time TEXT"),
        ("shifts", "actual_end_time TEXT"),
        ("shifts", "actual_hours_worked TEXT"),
        ("shifts", "needs_review INTEGER DEFAULT 0"),
        ("shifts", "reconciled_at TEXT"),
        ("shifts", "lunch_minutes INTEGER"),
        ("shifts", "lunch_start TEXT"),
        ("shifts", "queue_names TEXT"),
        ("shifts", "line TEXT"),
        ("schedules", "is_floating INTEGER DEFAULT 0"),
        ("schedules", "floating_days INTEGER"),
        ("schedules", "lunch_start TEXT"),
        ("schedules", "lunch_end TEXT"),
        ("tracked_projects", "target_sl INTEGER"),
        ("tracked_projects", "is_manual INTEGER DEFAULT 0"),
        ("tracked_projects", "has_inbound INTEGER DEFAULT 1"),
        ("tracked_projects", "has_outbound INTEGER DEFAULT 0"),
        ("tracked_projects", "work_start TEXT DEFAULT '00:00'"),
        ("tracked_projects", "work_end TEXT DEFAULT '24:00'"),
        ("queue_settings", "wrapup_sec INTEGER"),
        ("queue_settings", "show_in INTEGER DEFAULT 1"),
        ("queue_settings", "show_out INTEGER DEFAULT 0"),
        ("queue_settings", "hidden INTEGER DEFAULT 0"),
        ("status_configs", "project_uuid TEXT"),
        ("skills", "icon TEXT"),
    ]
    with db_engine.connect() as conn:
        for table, col_def in migrations:
            col_name = col_def.split()[0]
            try:
                rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
                existing = [row[1] for row in rows]
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_def}"))
            except Exception:
                pass
        conn.commit()


def init_db():
    from app.models import user, employee, team, skill, schedule, audit  # noqa
    Base.metadata.create_all(bind=engine)
    if "sqlite" in settings.WFM_DATABASE_URL:
        _sqlite_migrate(engine)

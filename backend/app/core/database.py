from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

engine = create_engine(
    settings.WFM_DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.WFM_DATABASE_URL else {},
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
        ("teams", "leader_id INTEGER REFERENCES employees(id)"),
        ("shifts", "actual_start_time TEXT"),
        ("shifts", "actual_end_time TEXT"),
        ("shifts", "actual_hours_worked TEXT"),
        ("shifts", "needs_review INTEGER DEFAULT 0"),
        ("shifts", "reconciled_at TEXT"),
        ("tracked_projects", "target_sl INTEGER"),
        ("tracked_projects", "is_manual INTEGER DEFAULT 0"),
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

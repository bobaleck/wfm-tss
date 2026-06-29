from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings
from app.core.database import init_db
from app.api.v1.router import api_router
from app.core.security import get_password_hash
from app.core.database import SessionLocal
from app.models.user import User

app = FastAPI(
    title="WFM Телесейлз-Сервис",
    description="Workforce Management Platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


_scheduler = BackgroundScheduler(timezone="Europe/Moscow")


@app.on_event("startup")
def startup():
    init_db()
    _seed_admin()
    _assign_orphans_to_x5()
    _scheduler.add_job(_run_daily_reconciliation, "cron", hour=7, minute=0)
    _scheduler.start()


@app.on_event("shutdown")
def shutdown():
    _scheduler.shutdown(wait=False)


def _run_daily_reconciliation():
    """Ежедневная сверка смен в 07:00 МСК."""
    from datetime import date, timedelta
    from app.models.schedule import Shift
    from app.models.employee import Employee
    from app.models.audit import IntegrationSettings
    from app.models import user as _u  # noqa – ensure all models loaded
    from datetime import datetime
    import app.services.naumen_db as naumen

    yesterday = date.today() - timedelta(days=1)
    db = SessionLocal()
    try:
        s = db.query(IntegrationSettings).first()
        overrides = {
            "host": s.db_host, "database": s.db_name,
            "user": s.db_user, "password": s.db_password, "port": s.db_port,
        } if s and s.db_host else None
        if not overrides:
            return

        shifts = db.query(Shift).join(Employee).filter(
            Shift.shift_date == yesterday,
            Shift.status.in_(["planned", "confirmed"]),
        ).all()

        for shift in shifts:
            emp = shift.employee
            if not emp or not emp.naumen_login:
                continue
            try:
                work_sec = naumen.get_operator_day_seconds(emp.naumen_login, str(yesterday), overrides)
            except Exception:
                continue

            actual_hours = round(work_sec / 3600, 2)
            shift.actual_hours_worked = str(actual_hours)
            shift.reconciled_at = datetime.utcnow()

            planned_hours = 0.0
            if shift.start_time and shift.end_time:
                try:
                    from datetime import datetime as dt
                    s_dt = dt.fromisoformat(shift.start_time[:16])
                    e_dt = dt.fromisoformat(shift.end_time[:16])
                    planned_hours = (e_dt - s_dt).total_seconds() / 3600
                except Exception:
                    pass

            if actual_hours > 0:
                shift.status = "completed"
                shift.needs_review = planned_hours > 0 and abs(actual_hours - planned_hours) > 1.0

        db.commit()
    except Exception:
        pass
    finally:
        db.close()


def _seed_admin():
    """Создаёт admin-пользователя при первом запуске."""
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == "admin").first():
            admin = User(
                username="admin",
                email="admin@telesales-service.ru",
                full_name="Администратор",
                hashed_password=get_password_hash("admin123"),
                role="admin",
                is_superuser=True,
                is_active=True,
            )
            db.add(admin)
            db.commit()
            print("[OK] Admin created: login=admin password=admin123")
    finally:
        db.close()


def _assign_orphans_to_x5():
    """Полная изоляция проектов: сотрудники/команды без проекта привязываются к
    проекту «X5» (по требованию — «всё, что некуда определить, — в X5»).
    Идемпотентно: трогает только записи с пустым project_uuid. Если проект с
    названием, содержащим «X5», не найден — миграция пропускается."""
    from sqlalchemy import or_
    from app.models.employee import Employee
    from app.models.team import Team
    from app.models.audit import TrackedProject
    db = SessionLocal()
    try:
        x5 = (db.query(TrackedProject)
              .filter(TrackedProject.customer_name.ilike("%X5%"))
              .order_by(TrackedProject.id)
              .first())
        if not x5:
            return
        uuid = x5.customer_uuid
        emp_n = db.query(Employee).filter(
            or_(Employee.project_uuid.is_(None), Employee.project_uuid == "")
        ).update({Employee.project_uuid: uuid}, synchronize_session=False)
        team_n = db.query(Team).filter(
            or_(Team.project_uuid.is_(None), Team.project_uuid == "")
        ).update({Team.project_uuid: uuid}, synchronize_session=False)
        if emp_n or team_n:
            db.commit()
            print(f"[OK] Orphans -> X5 ({x5.customer_name}): employees={emp_n}, teams={team_n}")
        else:
            db.rollback()
    except Exception as e:
        db.rollback()
        print(f"[WARN] orphan->X5 migration skipped: {e}")
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok", "service": "WFM Телесейлз-Сервис"}

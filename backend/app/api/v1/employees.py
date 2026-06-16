import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.core.database import get_db, SessionLocal
from app.models.employee import Employee, EmployeeSkill
from app.models.team import Team
from app.models.skill import Skill
from app.models.audit import IntegrationSettings
from app.schemas.employee import EmployeeCreate, EmployeeUpdate, EmployeeOut, EmployeeSkillOut
from app.api.deps import get_current_user, require_manager
import app.services.naumen_db as naumen

router = APIRouter()

# project_uuid -> {"status": "running"|"done"|"error", ...}. Синхронизация для
# крупного проекта (X5, 300+ операторов) может занимать несколько минут —
# держать HTTP-запрос открытым всё это время держит и поток, и соединение к
# локальной БД, что само провоцирует исчерпание connection pool. Поэтому
# /sync-naumen только запускает фоновый поток и сразу отвечает, а фронтенд
# опрашивает /sync-naumen/status. Процесс однопроцессный (uvicorn без
# воркеров), поэтому module-level dict достаточен — отдельное хранилище не нужно.
_sync_jobs: dict[str, dict] = {}


def _enrich(emp: Employee) -> dict:
    out = EmployeeOut.model_validate(emp).model_dump()
    out["team_name"] = emp.team.name if emp.team else None
    return out


def _build_overrides(db: Session):
    s = db.query(IntegrationSettings).first()
    if s and s.db_host:
        return {"host": s.db_host, "database": s.db_name, "user": s.db_user, "password": s.db_password, "port": s.db_port}
    return None


@router.get("", response_model=List[EmployeeOut])
def list_employees(
    project_uuid: Optional[str] = None,
    team_id: Optional[int] = None,
    search: Optional[str] = None,
    is_active: Optional[bool] = None,
    employment_status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(Employee).options(joinedload(Employee.team), joinedload(Employee.skills).joinedload(EmployeeSkill.skill))
    if project_uuid:
        q = q.filter(Employee.project_uuid == project_uuid)
    if team_id:
        q = q.filter(Employee.team_id == team_id)
    if is_active is not None:
        q = q.filter(Employee.is_active == is_active)
    if employment_status:
        q = q.filter(Employee.employment_status == employment_status)
    if search:
        q = q.filter(Employee.full_name.ilike(f"%{search}%"))
    employees = q.order_by(Employee.full_name).offset(skip).limit(limit).all()
    return [_enrich(e) for e in employees]


@router.post("", response_model=EmployeeOut, status_code=201)
def create_employee(body: EmployeeCreate, db: Session = Depends(get_db), _=Depends(require_manager)):
    skill_ids = body.skill_ids or []
    data = body.model_dump(exclude={"skill_ids"})
    # added_manually=True — синхронизация с Naumen никогда не трогает эту карточку
    # (не уволит/реактивирует/удалит по логину), даже если naumen_login заполнен.
    emp = Employee(**data, added_manually=True)
    db.add(emp)
    db.flush()
    for sid in skill_ids:
        db.add(EmployeeSkill(employee_id=emp.id, skill_id=sid))
    db.commit()
    db.refresh(emp)
    return _enrich(emp)


def _run_sync(project_uuid: str, overrides: Optional[dict]):
    """Правила синхронизации (см. также naumen.sync_employees_for_partner):

    Новые сотрудники (есть в Naumen, нет карточки у нас):
      - не входил 90+ дней — не добавляем;
      - входил, но не входил 30+ дней — добавляем со статусом "Уволен";
      - входил за последние 30 дней — добавляем со статусом "Новый".

    Существующие карточки, сопоставленные с Naumen (naumen_login задан и
    карточка не добавлена вручную — added_manually=False):
      - статус "Уволен": не входил 90+ дней — удаляем карточку;
        входил за последние 30 дней — статус меняется на "Новый" (реактивация);
        входил 30-90 дней назад — статус не меняется;
      - любой другой статус: не входил 30+ дней — статус меняется на "Уволен".

    Карточки, добавленные вручную (added_manually=True), синхронизацией не
    трогаются вовсе, даже если у них заполнен naumen_login."""
    job = _sync_jobs[project_uuid]
    db = SessionLocal()
    try:
        naumen_employees = naumen.sync_employees_for_partner(project_uuid, overrides)

        if not naumen_employees:
            job.update(status="done", finished_at=datetime.utcnow().isoformat(),
                       result={"ok": True, "added": 0, "reactivated": 0, "fired_auto": 0, "deleted_stale": 0,
                               "total_from_naumen": 0, "active_in_30d": 0,
                               "warning": "Naumen вернул пустой список сотрудников. Синхронизация пропущена."})
            return

        by_login = {ne["login"]: ne for ne in naumen_employees if ne.get("login")}
        active_in_30d = sum(1 for ne in by_login.values() if ne.get("is_active_30d"))

        added = reactivated = fired_auto = deleted_stale = 0

        synced_employees = db.query(Employee).filter(
            Employee.project_uuid == project_uuid,
            Employee.naumen_login.isnot(None),
            Employee.added_manually.is_(False),
        ).all()
        all_existing_logins = {
            row[0] for row in db.query(Employee.naumen_login).filter(
                Employee.project_uuid == project_uuid,
                Employee.naumen_login.isnot(None),
            ).all()
        }

        for emp in synced_employees:
            ne = by_login.get(emp.naumen_login)
            is_active_30d = bool(ne and ne.get("is_active_30d"))
            is_active_90d = bool(ne and ne.get("is_active_90d"))

            if emp.employment_status == "fired":
                if not is_active_90d:
                    db.delete(emp)
                    deleted_stale += 1
                elif is_active_30d:
                    emp.employment_status = "new"
                    reactivated += 1
                # 30-90 дней без входа — остаётся "Уволен", без изменений
            elif not is_active_30d:
                emp.employment_status = "fired"
                fired_auto += 1

        for login, ne in by_login.items():
            if login in all_existing_logins:
                continue
            if not ne.get("is_active_90d"):
                continue  # дольше 3 месяцев без входа — не добавляем
            emp = Employee(
                full_name=ne.get("employee_name") or login,
                naumen_login=login,
                employee_uuid=ne.get("employee_uuid"),
                position=ne.get("position"),
                email=ne.get("email"),
                project_uuid=project_uuid,
                employment_status="new" if ne.get("is_active_30d") else "fired",
                is_active=True,
            )
            db.add(emp)
            added += 1

        db.commit()
        job.update(status="done", finished_at=datetime.utcnow().isoformat(), result={
            "ok": True,
            "added": added,
            "reactivated": reactivated,
            "fired_auto": fired_auto,
            "deleted_stale": deleted_stale,
            "total_from_naumen": len(naumen_employees),
            "active_in_30d": active_in_30d,
        })
    except Exception as e:
        job.update(status="error", finished_at=datetime.utcnow().isoformat(), error=str(e))
    finally:
        db.close()


@router.post("/sync-naumen")
def sync_from_naumen(
    project_uuid: str = Query(..., description="UUID партнёра (customer_uuid)"),
    db: Session = Depends(get_db),
    _=Depends(require_manager),
):
    """
    Запускает синхронизацию сотрудников с Naumen в фоновом потоке (см. _run_sync) и
    сразу возвращает ответ — для крупных проектов (300+ операторов) сама синхронизация
    может занимать несколько минут, и держать HTTP-запрос открытым всё это время
    непрактично (таймауты браузера/прокси, занятый поток и connection pool).
    Прогресс — через GET /sync-naumen/status. Правила сопоставления — см. docstring _run_sync.
    """
    if _sync_jobs.get(project_uuid, {}).get("status") == "running":
        return {"status": "running"}

    overrides = _build_overrides(db)
    _sync_jobs[project_uuid] = {"status": "running", "started_at": datetime.utcnow().isoformat()}
    threading.Thread(target=_run_sync, args=(project_uuid, overrides), daemon=True).start()
    return {"status": "running"}


@router.get("/sync-naumen/status")
def sync_status(
    project_uuid: str = Query(...),
    _=Depends(get_current_user),
):
    return _sync_jobs.get(project_uuid, {"status": "idle"})


@router.get("/{emp_id}", response_model=EmployeeOut)
def get_employee(emp_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    emp = db.query(Employee).options(
        joinedload(Employee.team),
        joinedload(Employee.skills).joinedload(EmployeeSkill.skill)
    ).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(404, detail="Не найден")
    return _enrich(emp)


@router.put("/{emp_id}", response_model=EmployeeOut)
def update_employee(emp_id: int, body: EmployeeUpdate, db: Session = Depends(get_db), _=Depends(require_manager)):
    emp = db.query(Employee).options(
        joinedload(Employee.team),
        joinedload(Employee.skills).joinedload(EmployeeSkill.skill)
    ).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(404, detail="Не найден")
    data = body.model_dump(exclude_unset=True)
    skill_ids = data.pop("skill_ids", None)
    for k, v in data.items():
        setattr(emp, k, v)
    if skill_ids is not None:
        db.query(EmployeeSkill).filter(EmployeeSkill.employee_id == emp_id).delete()
        for sid in skill_ids:
            db.add(EmployeeSkill(employee_id=emp_id, skill_id=sid))
    db.commit()
    db.refresh(emp)
    return _enrich(emp)


@router.delete("/{emp_id}", status_code=204)
def delete_employee(emp_id: int, db: Session = Depends(get_db), _=Depends(require_manager)):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(404, detail="Не найден")
    db.delete(emp)
    db.commit()

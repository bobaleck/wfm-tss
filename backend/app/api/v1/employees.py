from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.core.database import get_db
from app.models.employee import Employee, EmployeeSkill
from app.models.team import Team
from app.models.skill import Skill
from app.models.audit import IntegrationSettings
from app.schemas.employee import EmployeeCreate, EmployeeUpdate, EmployeeOut, EmployeeSkillOut
from app.api.deps import get_current_user, require_manager
import app.services.naumen_db as naumen

router = APIRouter()


def _enrich(emp: Employee) -> dict:
    out = EmployeeOut.model_validate(emp).model_dump()
    out["team_name"] = emp.team.name if emp.team else None
    out["skills"] = []
    for es in emp.skills:
        out["skills"].append({"skill_id": es.skill_id, "skill_name": es.skill.name, "level": es.level})
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
    emp = Employee(**data)
    db.add(emp)
    db.flush()
    for sid in skill_ids:
        db.add(EmployeeSkill(employee_id=emp.id, skill_id=sid))
    db.commit()
    db.refresh(emp)
    return _enrich(emp)


@router.post("/sync-naumen")
def sync_from_naumen(
    project_uuid: str = Query(..., description="UUID партнёра (customer_uuid)"),
    db: Session = Depends(get_db),
    _=Depends(require_manager),
):
    """
    Синхронизация сотрудников с Naumen.
    - Новые → добавляются со статусом 'new' (если активны в 30 дней) или 'fired'.
    - Существующие → НЕ изменяются, кроме:
      a) автовыставление 'fired' если не активен 30+ дней
      b) удаление записи если в Naumen нет активности за 180+ дней (освобождение памяти)
    """
    from datetime import date, timedelta
    overrides = _build_overrides(db)

    try:
        naumen_employees = naumen.sync_employees_for_partner(project_uuid, overrides)
    except Exception as e:
        raise HTTPException(503, detail=str(e))

    naumen_logins = {ne.get("login") for ne in naumen_employees if ne.get("login")}

    # Если из Naumen вернулся пустой список — что-то не так, прерываем синхронизацию
    if not naumen_employees:
        return {"ok": True, "added": 0, "fired_auto": 0, "deleted_stale": 0,
                "total_from_naumen": 0, "active_in_30d": 0,
                "warning": "Naumen вернул пустой список сотрудников. Синхронизация пропущена."}

    # Активные за 30 дней (для статуса) — при ошибке ПРЕРЫВАЕМ, не маркируем всех уволенными
    try:
        cutoff_30 = (date.today() - timedelta(days=30)).isoformat()
        active_logins = naumen.get_active_logins_since(project_uuid, cutoff_30, overrides)
    except Exception as e:
        raise HTTPException(503, detail=f"Не удалось получить список активных операторов (30д): {e}")

    # Активные за 180 дней (для удаления)
    try:
        cutoff_180 = (date.today() - timedelta(days=180)).isoformat()
        active_6mo = naumen.get_active_logins_since(project_uuid, cutoff_180, overrides)
    except Exception as e:
        raise HTTPException(503, detail=f"Не удалось получить список активных операторов (180д): {e}")

    added = 0
    fired_auto = 0
    deleted_stale = 0

    for ne in naumen_employees:
        login = ne.get("login")
        if not login:
            continue

        existing = db.query(Employee).filter(
            Employee.naumen_login == login,
            Employee.project_uuid == project_uuid,
        ).first()

        is_active_30d = login in active_logins
        is_active_6mo = login in active_6mo

        if existing:
            if not is_active_6mo and existing.employment_status == "fired":
                # Уволен и не заходил 6+ месяцев — удаляем
                db.delete(existing)
                deleted_stale += 1
            elif not is_active_30d and existing.employment_status != "fired":
                existing.employment_status = "fired"
                fired_auto += 1
        else:
            if not is_active_6mo:
                # Не был активен 6 месяцев и нет в базе — пропускаем
                continue
            emp = Employee(
                full_name=ne.get("employee_name") or login,
                naumen_login=login,
                employee_uuid=ne.get("employee_uuid"),
                position=ne.get("position"),
                email=ne.get("email"),
                project_uuid=project_uuid,
                employment_status="new" if is_active_30d else "fired",
                is_active=True,
            )
            db.add(emp)
            added += 1

    db.commit()
    return {
        "ok": True,
        "added": added,
        "fired_auto": fired_auto,
        "deleted_stale": deleted_stale,
        "total_from_naumen": len(naumen_employees),
        "active_in_30d": len(active_logins),
    }


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

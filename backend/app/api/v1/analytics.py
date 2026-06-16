from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date

from app.api.deps import get_current_user, check_project_access
from app.core.database import get_db
from app.models.audit import IntegrationSettings, QueueSetting, StatusConfig
from app.models.employee import Employee
from app.services.status_classification import build_status_sets
import app.services.naumen_db as naumen

router = APIRouter()


def _build_overrides(db: Session) -> Optional[dict]:
    s = db.query(IntegrationSettings).first()
    if s and s.db_host:
        return {
            "host": s.db_host,
            "database": s.db_name,
            "user": s.db_user,
            "password": s.db_password,
            "port": s.db_port,
        }
    return None


def _status_sets(db: Session, partner_uuid: str) -> tuple[list[str], list[str]]:
    """Рабочие/офлайн статусы для проекта — стандартные + индивидуальные настройки.
    Та же классификация используется и в Онлайн-мониторинге, и в истории смен."""
    configs = db.query(StatusConfig).filter(StatusConfig.project_uuid == partner_uuid).all()
    return build_status_sets(configs)


@router.get("/projects")
def get_projects(db: Session = Depends(get_db), _=Depends(get_current_user)):
    try:
        return {"data": naumen.get_projects(_build_overrides(db))}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/queues")
def get_queues(partner_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    check_project_access(partner_uuid, current_user, db)
    try:
        queues = naumen.get_queues(partner_uuid, _build_overrides(db))
        # Apply WFM overrides (target_sl, answer_sec) on top of Naumen values
        overrides = {
            r.queue_name: r
            for r in db.query(QueueSetting).filter(QueueSetting.partner_uuid == partner_uuid).all()
        }
        for q in queues:
            ov = overrides.get(q.get("name"))
            if ov:
                if ov.target_sl is not None:
                    q["target_sl"] = ov.target_sl
                if ov.answer_sec is not None:
                    q["answer_sec"] = ov.answer_sec
        return {"data": queues}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/workload")
def get_workload(
    partner_uuid: str,
    begin: date = Query(...),
    end: date = Query(...),
    interval: str = "hour",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    check_project_access(partner_uuid, current_user, db)
    if end <= begin:
        raise HTTPException(400, detail="end должна быть больше begin")
    try:
        data = naumen.get_workload(partner_uuid, str(begin), str(end), interval, _build_overrides(db))
        return {"data": data, "meta": {"begin": str(begin), "end": str(end), "interval": interval}}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/operator-load")
def get_operator_load(
    partner_uuid: str,
    begin: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    check_project_access(partner_uuid, current_user, db)
    if end <= begin:
        raise HTTPException(400, detail="end должна быть больше begin")
    try:
        work_statuses, offline_statuses = _status_sets(db, partner_uuid)
        data = naumen.get_operator_load(
            partner_uuid, str(begin), str(end), work_statuses, offline_statuses, _build_overrides(db),
        )
        return {"data": data, "meta": {"begin": str(begin), "end": str(end)}}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/status-summary")
def get_status_summary(
    partner_uuid: str,
    begin: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    try:
        data = naumen.get_status_summary(partner_uuid, str(begin), str(end), _build_overrides(db))
        return {"data": data}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/operator-sessions")
def get_operator_sessions(
    partner_uuid: str,
    begin: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    История сессий операторов из Naumen status_changes.
    Берёт логины сотрудников проекта из локальной БД, обогащает именами.
    """
    if end <= begin:
        raise HTTPException(400, detail="end должна быть больше begin")

    # Логины сотрудников этого проекта из нашей БД
    employees = db.query(Employee).filter(
        Employee.project_uuid == partner_uuid,
        Employee.naumen_login.isnot(None),
    ).all()
    login_map = {e.naumen_login: e.full_name for e in employees}
    logins = list(login_map.keys())

    if not logins:
        return {"data": [], "meta": {"logins_found": 0}}

    try:
        work_statuses, offline_statuses = _status_sets(db, partner_uuid)
        rows = naumen.get_operator_sessions(
            logins, str(begin), str(end), work_statuses, offline_statuses, _build_overrides(db),
        )
        for r in rows:
            r["employee_name"] = login_map.get(r.get("login"), r.get("login"))
        return {"data": rows, "meta": {"logins_found": len(logins), "begin": str(begin), "end": str(end)}}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/operator-timeline")
def get_operator_timeline(
    login: str,
    work_date: Optional[str] = None,
    hours: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Временная линия статусов оператора — либо за календарный день (work_date,
    используется в Сменах), либо за скользящее окно в hours часов до текущего
    момента (используется в Онлайн-мониторинге)."""
    try:
        if hours is not None:
            data = naumen.get_operator_timeline_window(login, hours, _build_overrides(db))
        elif work_date is not None:
            data = naumen.get_operator_timeline(login, work_date, _build_overrides(db))
        else:
            raise HTTPException(400, detail="Укажите work_date или hours")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/actual-operators")
def get_actual_operators(
    partner_uuid: str,
    begin: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Среднее фактическое число операторов по часам суток за период."""
    if end <= begin:
        raise HTTPException(400, detail="end должна быть больше begin")
    employees = db.query(Employee).filter(
        Employee.project_uuid == partner_uuid,
        Employee.naumen_login.isnot(None),
    ).all()
    logins = [e.naumen_login for e in employees]
    try:
        data = naumen.get_actual_operators_by_hour(logins, str(begin), str(end), _build_overrides(db))
        return {"data": data}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/current-operators")
def get_current_operators(
    partner_uuid: str,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    """Текущий статус операторов проекта — берёт логины прямо из Naumen."""
    # Local name overrides (our DB has richer names)
    employees = db.query(Employee).filter(
        Employee.project_uuid == partner_uuid,
        Employee.naumen_login.isnot(None),
    ).all()
    local_names = {e.naumen_login: e.full_name for e in employees}
    try:
        rows = naumen.get_current_operators_for_project(partner_uuid, _build_overrides(db))
        for r in rows:
            local = local_names.get(r.get("login"))
            if local:
                r["employee_name"] = local
        return {"data": rows, "total_logins": len(rows)}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/naumen-employees")
def get_naumen_employees(
    partner_uuid: str,
    begin: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    try:
        data = naumen.get_naumen_employees(partner_uuid, str(begin), str(end), _build_overrides(db))
        return {"data": data}
    except Exception as e:
        raise HTTPException(503, detail=str(e))

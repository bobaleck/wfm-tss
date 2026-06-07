from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import date

from app.core.database import get_db
from app.models.schedule import Schedule, Shift, Absence
from app.models.employee import Employee
from datetime import datetime
from app.schemas.schedule import (
    ScheduleCreate, ScheduleUpdate, ScheduleOut,
    ShiftCreate, ShiftUpdate, ShiftOut, ShiftConfirm,
    AbsenceCreate, AbsenceUpdate, AbsenceOut,
)
from app.api.deps import get_current_user, require_manager

router = APIRouter()


# ─── Шаблоны расписаний ───────────────────────────────────────────────────────

@router.get("", response_model=List[ScheduleOut])
def list_schedules(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Schedule).order_by(Schedule.name).all()


@router.post("", response_model=ScheduleOut, status_code=201)
def create_schedule(body: ScheduleCreate, db: Session = Depends(get_db), _=Depends(require_manager)):
    s = Schedule(**body.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.put("/{schedule_id}", response_model=ScheduleOut)
def update_schedule(schedule_id: int, body: ScheduleUpdate,
                    db: Session = Depends(get_db), _=Depends(require_manager)):
    s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not s:
        raise HTTPException(404, "Не найдено")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s


@router.delete("/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: int, db: Session = Depends(get_db), _=Depends(require_manager)):
    s = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not s:
        raise HTTPException(404, "Не найдено")
    db.delete(s)
    db.commit()


# ─── Смены сотрудников ────────────────────────────────────────────────────────

@router.get("/shifts", response_model=List[ShiftOut])
def list_shifts(
    employee_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    project_uuid: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(Shift).join(Employee)
    if employee_id:
        q = q.filter(Shift.employee_id == employee_id)
    if date_from:
        q = q.filter(Shift.shift_date >= date_from)
    if date_to:
        q = q.filter(Shift.shift_date <= date_to)
    if project_uuid:
        q = q.filter(Employee.project_uuid == project_uuid)
    shifts = q.order_by(Shift.shift_date, Shift.start_time).all()
    result = []
    for sh in shifts:
        out = ShiftOut.model_validate(sh).model_dump()
        out["employee_name"] = sh.employee.full_name if sh.employee else None
        out["schedule_name"] = sh.schedule.name if sh.schedule else None
        result.append(out)
    return result


@router.post("/shifts", response_model=ShiftOut, status_code=201)
def create_shift(body: ShiftCreate, db: Session = Depends(get_db), _=Depends(require_manager)):
    shift = Shift(**body.model_dump())
    db.add(shift)
    db.commit()
    db.refresh(shift)
    out = ShiftOut.model_validate(shift).model_dump()
    out["employee_name"] = shift.employee.full_name if shift.employee else None
    out["schedule_name"] = shift.schedule.name if shift.schedule else None
    return out


@router.put("/shifts/{shift_id}", response_model=ShiftOut)
def update_shift(shift_id: int, body: ShiftUpdate,
                 db: Session = Depends(get_db), _=Depends(require_manager)):
    shift = db.query(Shift).filter(Shift.id == shift_id).first()
    if not shift:
        raise HTTPException(404, "Не найдена")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(shift, k, v)
    db.commit()
    db.refresh(shift)
    out = ShiftOut.model_validate(shift).model_dump()
    out["employee_name"] = shift.employee.full_name if shift.employee else None
    out["schedule_name"] = shift.schedule.name if shift.schedule else None
    return out


@router.delete("/shifts/{shift_id}", status_code=204)
def delete_shift(shift_id: int, db: Session = Depends(get_db), _=Depends(require_manager)):
    shift = db.query(Shift).filter(Shift.id == shift_id).first()
    if not shift:
        raise HTTPException(404, "Не найдена")
    db.delete(shift)
    db.commit()


@router.post("/shifts/{shift_id}/confirm")
def confirm_shift(
    shift_id: int,
    body: ShiftConfirm,
    db: Session = Depends(get_db),
    _=Depends(require_manager),
):
    """Подтвердить смену и/или указать фактически отработанные часы."""
    shift = db.query(Shift).filter(Shift.id == shift_id).first()
    if not shift:
        raise HTTPException(404, "Смена не найдена")
    shift.actual_start_time = body.actual_start_time or shift.start_time
    shift.actual_end_time = body.actual_end_time or shift.end_time
    shift.actual_hours_worked = body.actual_hours_worked
    shift.needs_review = False
    shift.status = "completed"
    shift.reconciled_at = datetime.utcnow()
    db.commit()
    db.refresh(shift)
    out = ShiftOut.model_validate(shift).model_dump()
    out["employee_name"] = shift.employee.full_name if shift.employee else None
    out["schedule_name"] = shift.schedule.name if shift.schedule else None
    return out


@router.post("/shifts/reconcile")
def reconcile_shifts(
    reconcile_date: Optional[date] = None,
    db: Session = Depends(get_db),
    _=Depends(require_manager),
):
    """
    Сверка плановых смен с данными Naumen за указанную дату (по умолчанию — вчера).
    Вычисляет фактически отработанные часы из status_changes и помечает расхождения.
    """
    from datetime import date as date_type, timedelta
    from app.models.audit import IntegrationSettings
    import app.services.naumen_db as naumen

    target_date = reconcile_date or (date_type.today() - timedelta(days=1))

    s = db.query(IntegrationSettings).first()
    overrides = {
        "host": s.db_host, "database": s.db_name,
        "user": s.db_user, "password": s.db_password, "port": s.db_port,
    } if s and s.db_host else None

    shifts = db.query(Shift).join(Employee).filter(
        Shift.shift_date == target_date,
        Shift.status.in_(["planned", "confirmed"]),
    ).all()

    updated, flagged, skipped = 0, 0, 0
    for shift in shifts:
        emp = shift.employee
        if not emp or not emp.naumen_login:
            skipped += 1
            continue
        try:
            work_sec = naumen.get_operator_day_seconds(emp.naumen_login, str(target_date), overrides)
        except Exception:
            skipped += 1
            continue

        actual_hours = round(work_sec / 3600, 2)
        shift.actual_hours_worked = str(actual_hours)
        shift.reconciled_at = datetime.utcnow()

        planned_hours = 0.0
        if shift.start_time and shift.end_time:
            try:
                from datetime import datetime as dt
                fmt = "%Y-%m-%dT%H:%M"
                s_dt = dt.fromisoformat(shift.start_time[:16])
                e_dt = dt.fromisoformat(shift.end_time[:16])
                planned_hours = (e_dt - s_dt).total_seconds() / 3600
            except Exception:
                pass

        if actual_hours > 0:
            shift.status = "completed"
            if planned_hours > 0 and abs(actual_hours - planned_hours) > 1.0:
                shift.needs_review = True
                flagged += 1
            else:
                shift.needs_review = False
                updated += 1
        else:
            skipped += 1

    db.commit()
    return {"ok": True, "date": str(target_date), "updated": updated, "flagged": flagged, "skipped": skipped}


# ─── Отсутствия ───────────────────────────────────────────────────────────────

@router.get("/absences", response_model=List[AbsenceOut])
def list_absences(
    employee_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    absence_type: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(Absence)
    if employee_id:
        q = q.filter(Absence.employee_id == employee_id)
    if date_from:
        q = q.filter(Absence.end_date >= date_from)
    if date_to:
        q = q.filter(Absence.start_date <= date_to)
    if absence_type:
        q = q.filter(Absence.absence_type == absence_type)
    absences = q.order_by(Absence.start_date).all()
    result = []
    for ab in absences:
        out = AbsenceOut.model_validate(ab).model_dump()
        out["employee_name"] = ab.employee.full_name if ab.employee else None
        result.append(out)
    return result


@router.post("/absences", response_model=AbsenceOut, status_code=201)
def create_absence(body: AbsenceCreate, db: Session = Depends(get_db), _=Depends(require_manager)):
    ab = Absence(**body.model_dump())
    db.add(ab)
    db.commit()
    db.refresh(ab)
    out = AbsenceOut.model_validate(ab).model_dump()
    out["employee_name"] = ab.employee.full_name if ab.employee else None
    return out


@router.put("/absences/{absence_id}", response_model=AbsenceOut)
def update_absence(absence_id: int, body: AbsenceUpdate,
                   db: Session = Depends(get_db), _=Depends(require_manager)):
    ab = db.query(Absence).filter(Absence.id == absence_id).first()
    if not ab:
        raise HTTPException(404, "Не найдено")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ab, k, v)
    db.commit()
    db.refresh(ab)
    out = AbsenceOut.model_validate(ab).model_dump()
    out["employee_name"] = ab.employee.full_name if ab.employee else None
    return out


@router.delete("/absences/{absence_id}", status_code=204)
def delete_absence(absence_id: int, db: Session = Depends(get_db), _=Depends(require_manager)):
    ab = db.query(Absence).filter(Absence.id == absence_id).first()
    if not ab:
        raise HTTPException(404, "Не найдено")
    db.delete(ab)
    db.commit()

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.models.audit import IntegrationSettings, TrackedProject
from app.api.deps import require_admin, get_current_user, get_user_project_uuids
from app.models.user import User
import app.services.naumen_db as naumen

router = APIRouter()


class IntegrationSettingsIn(BaseModel):
    db_host: Optional[str] = None
    db_name: Optional[str] = None
    db_user: Optional[str] = None
    db_password: Optional[str] = None
    db_port: Optional[int] = 5432
    api_base_url: Optional[str] = None
    api_username: Optional[str] = None
    api_key: Optional[str] = None


class IntegrationSettingsOut(BaseModel):
    db_host: Optional[str] = None
    db_name: Optional[str] = None
    db_user: Optional[str] = None
    db_port: Optional[int] = None
    api_base_url: Optional[str] = None
    api_username: Optional[str] = None
    has_password: bool = False
    has_api_key: bool = False
    is_active: bool = True

    class Config:
        from_attributes = True


class TrackedProjectIn(BaseModel):
    # customer_uuid необязателен: при обновлении он берётся из URL, при создании
    # вручную — генерируется. Если бы он был обязательным, PUT-редактирование
    # (где uuid только в пути) падало бы с 422 и «Сохранить» молча не срабатывало.
    customer_uuid: Optional[str] = None
    customer_name: Optional[str] = None
    customer_type: Optional[str] = None
    responsible_manager: Optional[str] = None
    target_sl: Optional[int] = None
    is_manual: Optional[bool] = False
    has_inbound: Optional[bool] = None
    has_outbound: Optional[bool] = None
    work_start: Optional[str] = None
    work_end: Optional[str] = None


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


@router.get("", response_model=IntegrationSettingsOut)
def get_integration(db: Session = Depends(get_db), _=Depends(require_admin)):
    settings = db.query(IntegrationSettings).first()
    if not settings:
        return IntegrationSettingsOut()
    out = IntegrationSettingsOut.model_validate(settings)
    out.has_password = bool(settings.db_password)
    out.has_api_key = bool(settings.api_key)
    return out


@router.put("")
def save_integration(body: IntegrationSettingsIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    settings = db.query(IntegrationSettings).first()
    if not settings:
        settings = IntegrationSettings()
        db.add(settings)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            setattr(settings, k, v)
    db.commit()
    return {"ok": True, "message": "Настройки сохранены"}


@router.post("/test")
def test_connection(db: Session = Depends(get_db), _=Depends(require_admin)):
    overrides = _build_overrides(db)
    result = naumen.test_connection(overrides)
    return result


@router.post("/test-api")
def test_api_connection(db: Session = Depends(get_db), _=Depends(require_admin)):
    s = db.query(IntegrationSettings).first()
    if not s or not s.api_base_url:
        return {"ok": False, "message": "API URL не настроен"}
    try:
        from urllib.request import urlopen, Request
        from urllib.error import URLError
        import ssl
        req = Request(s.api_base_url)
        if s.api_key:
            req.add_header("X-API-Key", s.api_key)
        if s.api_username:
            req.add_header("X-Username", s.api_username)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urlopen(req, timeout=10, context=ctx) as resp:
            return {"ok": True, "message": f"Соединение установлено (HTTP {resp.status})"}
    except URLError as e:
        reason = str(e.reason) if hasattr(e, "reason") else str(e)
        if "401" in reason or "403" in reason:
            return {"ok": True, "message": f"Сервер доступен (требуется авторизация)"}
        return {"ok": False, "message": f"Ошибка подключения: {reason}"}
    except Exception as e:
        msg = str(e)
        if "401" in msg or "403" in msg:
            return {"ok": True, "message": "Сервер доступен (требуется авторизация)"}
        return {"ok": False, "message": msg}


@router.get("/projects/available")
def get_available_projects(db: Session = Depends(get_db), _=Depends(require_admin)):
    overrides = _build_overrides(db)
    try:
        data = naumen.get_projects(overrides)
        return {"data": data}
    except Exception as e:
        raise HTTPException(503, detail=str(e))


@router.get("/tracked-projects")
def list_tracked_projects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    allowed_uuids = get_user_project_uuids(current_user, db)
    q = db.query(TrackedProject).order_by(TrackedProject.customer_name)
    if allowed_uuids is not None:
        q = q.filter(TrackedProject.customer_uuid.in_(allowed_uuids))
    projects = q.all()
    return [
        {
            "customer_uuid": p.customer_uuid,
            "customer_name": p.customer_name,
            "customer_type": p.customer_type or "",
            "responsible_manager": p.responsible_manager,
            "target_sl": p.target_sl,
            "is_manual": bool(p.is_manual),
            "has_inbound": bool(p.has_inbound) if p.has_inbound is not None else True,
            "has_outbound": bool(p.has_outbound) if p.has_outbound is not None else False,
            "work_start": p.work_start or "00:00",
            "work_end": p.work_end or "24:00",
            "active_projects_count": 0,
            "active_incoming_count": 0,
            "active_outcoming_count": 0,
        }
        for p in projects
    ]


@router.put("/tracked-projects/{uuid}")
def update_tracked_project(uuid: str, body: TrackedProjectIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    project = db.query(TrackedProject).filter(TrackedProject.customer_uuid == uuid).first()
    if not project:
        raise HTTPException(404, detail="Не найден")
    if body.customer_name:
        project.customer_name = body.customer_name
    if body.customer_type is not None:
        project.customer_type = body.customer_type
    if body.responsible_manager is not None:
        project.responsible_manager = body.responsible_manager
    if body.target_sl is not None:
        project.target_sl = body.target_sl
    if body.has_inbound is not None:
        project.has_inbound = body.has_inbound
    if body.has_outbound is not None:
        project.has_outbound = body.has_outbound
    if body.work_start is not None:
        project.work_start = body.work_start
    if body.work_end is not None:
        project.work_end = body.work_end
    db.commit()
    return {"ok": True}


@router.post("/tracked-projects", status_code=201)
def add_tracked_project(body: TrackedProjectIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    if not (body.customer_name and body.customer_name.strip()):
        raise HTTPException(400, detail="Укажите название проекта")
    if body.customer_uuid and db.query(TrackedProject).filter(TrackedProject.customer_uuid == body.customer_uuid).first():
        raise HTTPException(409, detail="Проект уже добавлен")
    import uuid as _uuid
    project = TrackedProject(
        customer_uuid=body.customer_uuid or str(_uuid.uuid4()),
        customer_name=body.customer_name,
        customer_type=body.customer_type,
        responsible_manager=body.responsible_manager,
        target_sl=body.target_sl,
        is_manual=1 if body.is_manual else 0,
        has_inbound=body.has_inbound if body.has_inbound is not None else True,
        has_outbound=body.has_outbound if body.has_outbound is not None else False,
        work_start=body.work_start or "00:00",
        work_end=body.work_end or "24:00",
    )
    db.add(project)
    db.commit()
    return {"ok": True, "customer_uuid": project.customer_uuid}


@router.delete("/tracked-projects/{uuid}", status_code=204)
def remove_tracked_project(uuid: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    project = db.query(TrackedProject).filter(TrackedProject.customer_uuid == uuid).first()
    if not project:
        raise HTTPException(404, detail="Не найден")
    db.delete(project)
    db.commit()

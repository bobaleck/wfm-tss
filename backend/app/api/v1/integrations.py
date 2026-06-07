from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.models.audit import IntegrationSettings, TrackedProject
from app.api.deps import require_admin, get_current_user
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
    customer_uuid: str
    customer_name: str
    customer_type: Optional[str] = None
    responsible_manager: Optional[str] = None


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
def list_tracked_projects(db: Session = Depends(get_db), _=Depends(get_current_user)):
    projects = db.query(TrackedProject).order_by(TrackedProject.customer_name).all()
    return [
        {
            "customer_uuid": p.customer_uuid,
            "customer_name": p.customer_name,
            "customer_type": p.customer_type or "",
            "responsible_manager": p.responsible_manager,
            "active_projects_count": 0,
            "active_incoming_count": 0,
            "active_outcoming_count": 0,
        }
        for p in projects
    ]


@router.post("/tracked-projects", status_code=201)
def add_tracked_project(body: TrackedProjectIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(TrackedProject).filter(TrackedProject.customer_uuid == body.customer_uuid).first():
        raise HTTPException(409, detail="Проект уже добавлен")
    project = TrackedProject(
        customer_uuid=body.customer_uuid,
        customer_name=body.customer_name,
        customer_type=body.customer_type,
        responsible_manager=body.responsible_manager,
    )
    db.add(project)
    db.commit()
    return {"ok": True}


@router.delete("/tracked-projects/{uuid}", status_code=204)
def remove_tracked_project(uuid: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    project = db.query(TrackedProject).filter(TrackedProject.customer_uuid == uuid).first()
    if not project:
        raise HTTPException(404, detail="Не найден")
    db.delete(project)
    db.commit()

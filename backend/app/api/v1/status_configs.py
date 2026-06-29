from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.models.audit import StatusConfig, IntegrationSettings
from app.api.deps import get_current_user, require_admin, check_project_access
from app.services.status_classification import is_standard, standard_group
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


class StatusConfigBody(BaseModel):
    classification: str  # work | pause | offline
    label: Optional[str] = None


@router.get("/{partner_uuid}")
def list_configs(partner_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    check_project_access(partner_uuid, current_user, db)
    items = db.query(StatusConfig).filter(StatusConfig.project_uuid == partner_uuid).order_by(StatusConfig.status_name).all()
    return [
        {"status_name": i.status_name, "classification": i.classification, "label": i.label}
        for i in items
    ]


@router.get("/{partner_uuid}/discover")
def discover_statuses(partner_uuid: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Тянет из Naumen все статусы, реально встречавшиеся у операторов проекта,
    помечает стандартные (классификация задана системой) и нестандартные
    (требуют настройки — наименование + к чему относить), подмешивая уже
    сохранённые настройки этого проекта."""
    check_project_access(partner_uuid, current_user, db)
    try:
        statuses = naumen.get_distinct_statuses_for_project(partner_uuid, _build_overrides(db))
    except Exception as e:
        raise HTTPException(503, detail=str(e))

    configs = {
        c.status_name.lower(): c
        for c in db.query(StatusConfig).filter(StatusConfig.project_uuid == partner_uuid).all()
    }

    # Уже сохранённые (ранее настроенные) статусы должны остаться на странице,
    # даже если за последний lookback-период они не встречались у операторов —
    # иначе при сокращении окна выгрузки (см. naumen.get_distinct_statuses_for_project)
    # они бы пропадали из списка.
    seen = {s.lower() for s in statuses}
    all_names = list(statuses) + [c.status_name for c in configs.values() if c.status_name.lower() not in seen]

    result = []
    for status_name in all_names:
        cfg = configs.get(status_name.lower())
        std = is_standard(status_name)
        result.append({
            "status_name": status_name,
            "is_standard": std,
            "standard_group": standard_group(status_name) if std else None,
            "classification": cfg.classification if cfg else None,
            "label": cfg.label if cfg else None,
        })
    return {"data": result}


@router.put("/{partner_uuid}/{status_name}")
def upsert_config(
    partner_uuid: str,
    status_name: str,
    body: StatusConfigBody,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    check_project_access(partner_uuid, current_user, db)
    if body.classification not in ("work", "pause", "offline"):
        raise HTTPException(400, detail="classification должен быть work | pause | offline")
    cfg = db.query(StatusConfig).filter(
        StatusConfig.project_uuid == partner_uuid,
        StatusConfig.status_name == status_name,
    ).first()
    if cfg:
        cfg.classification = body.classification
        cfg.label = body.label or None
    else:
        cfg = StatusConfig(
            project_uuid=partner_uuid,
            status_name=status_name,
            classification=body.classification,
            label=body.label or None,
        )
        db.add(cfg)
    db.commit()
    return {"ok": True, "status_name": status_name, "classification": body.classification}


@router.delete("/{partner_uuid}/{status_name}")
def delete_config(
    partner_uuid: str,
    status_name: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    check_project_access(partner_uuid, current_user, db)
    cfg = db.query(StatusConfig).filter(
        StatusConfig.project_uuid == partner_uuid,
        StatusConfig.status_name == status_name,
    ).first()
    if not cfg:
        raise HTTPException(404, detail="Не найдено")
    db.delete(cfg)
    db.commit()
    return {"ok": True}

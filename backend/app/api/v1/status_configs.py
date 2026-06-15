from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.models.audit import StatusConfig
from app.api.deps import get_current_user

router = APIRouter()


class StatusConfigBody(BaseModel):
    classification: str  # work | pause | offline
    label: Optional[str] = None


@router.get("")
def list_configs(db: Session = Depends(get_db), _=Depends(get_current_user)):
    items = db.query(StatusConfig).order_by(StatusConfig.status_name).all()
    return [
        {"id": i.id, "status_name": i.status_name, "classification": i.classification, "label": i.label}
        for i in items
    ]


@router.put("/{status_name}")
def upsert_config(
    status_name: str,
    body: StatusConfigBody,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if body.classification not in ("work", "pause", "offline"):
        raise HTTPException(400, detail="classification должен быть work | pause | offline")
    cfg = db.query(StatusConfig).filter(StatusConfig.status_name == status_name).first()
    if cfg:
        cfg.classification = body.classification
        cfg.label = body.label or None
    else:
        cfg = StatusConfig(status_name=status_name, classification=body.classification, label=body.label or None)
        db.add(cfg)
    db.commit()
    return {"ok": True, "status_name": status_name, "classification": body.classification}


@router.delete("/{status_name}")
def delete_config(
    status_name: str,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    cfg = db.query(StatusConfig).filter(StatusConfig.status_name == status_name).first()
    if not cfg:
        raise HTTPException(404, detail="Не найдено")
    db.delete(cfg)
    db.commit()
    return {"ok": True}

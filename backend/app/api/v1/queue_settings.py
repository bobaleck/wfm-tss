from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from app.core.database import get_db
from app.models.audit import QueueSetting
from app.api.deps import get_current_user, require_admin

router = APIRouter()


class QueueSettingIn(BaseModel):
    queue_name: str
    target_sl: Optional[int] = None
    answer_sec: Optional[int] = None


@router.get("/{partner_uuid}")
def get_queue_settings(partner_uuid: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(QueueSetting).filter(QueueSetting.partner_uuid == partner_uuid).all()
    return [
        {
            "queue_name": r.queue_name,
            "target_sl": r.target_sl,
            "answer_sec": r.answer_sec,
        }
        for r in rows
    ]


@router.put("/{partner_uuid}")
def save_queue_settings(
    partner_uuid: str,
    items: List[QueueSettingIn],
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    for item in items:
        existing = db.query(QueueSetting).filter(
            QueueSetting.partner_uuid == partner_uuid,
            QueueSetting.queue_name == item.queue_name,
        ).first()
        if existing:
            existing.target_sl = item.target_sl
            existing.answer_sec = item.answer_sec
        else:
            db.add(QueueSetting(
                partner_uuid=partner_uuid,
                queue_name=item.queue_name,
                target_sl=item.target_sl,
                answer_sec=item.answer_sec,
            ))
    db.commit()
    return {"ok": True, "updated": len(items)}


@router.delete("/{partner_uuid}/{queue_name}")
def delete_queue_setting(
    partner_uuid: str,
    queue_name: str,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    row = db.query(QueueSetting).filter(
        QueueSetting.partner_uuid == partner_uuid,
        QueueSetting.queue_name == queue_name,
    ).first()
    if not row:
        raise HTTPException(404, detail="Не найдено")
    db.delete(row)
    db.commit()
    return {"ok": True}

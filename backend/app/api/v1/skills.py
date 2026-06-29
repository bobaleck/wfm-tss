from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional

from app.core.database import get_db

DEFAULT_SKILLS = [
    ("Исходящие звонки", "OUTBOUND", "Обработка исходящих звонков"),
    ("Входящие звонки", "INBOUND", "Обработка входящих звонков"),
    ("Холодные звонки", "COLD_CALL", "Поиск и привлечение новых клиентов"),
    ("Чат-поддержка", "CHAT", "Работа с онлайн-чатами и мессенджерами"),
    ("Email-переписка", "EMAIL", "Работа с электронной почтой"),
    ("Кросс-продажи", "CROSS_SELL", "Предложение дополнительных продуктов"),
    ("Работа с возражениями", "OBJECTIONS", "Преодоление возражений клиентов"),
    ("Удержание клиентов", "RETENTION", "Предотвращение оттока, работа с оттоком"),
    ("Техподдержка", "TECH_SUPPORT", "Техническая поддержка пользователей"),
    ("Оформление заказов", "ORDERS", "Приём и оформление заявок и заказов"),
    ("Работа с жалобами", "COMPLAINTS", "Обработка претензий и жалоб"),
    ("Телемаркетинг", "TELEMARKETING", "Маркетинговые и информационные звонки"),
    ("Верификация данных", "VERIFICATION", "Первичная проверка данных клиентов"),
    ("Работа в CRM", "CRM", "Уверенное использование CRM-систем"),
    ("Опросы клиентов", "SURVEYS", "Проведение опросов и анкетирования"),
]
from app.models.skill import Skill
from app.models.employee import EmployeeSkill
from app.schemas.skill import SkillCreate, SkillUpdate, SkillOut
from app.api.deps import get_current_user, require_manager, check_project_access, resolve_project_scope

router = APIRouter()


@router.get("", response_model=List[SkillOut])
def list_skills(project_uuid: Optional[str] = None, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    scope = resolve_project_scope(project_uuid, current_user, db)
    q = db.query(Skill)
    if scope is not None:
        # Видны навыки проекта + общие (глобальный справочник, project_uuid IS NULL)
        q = q.filter(or_(Skill.project_uuid.in_(scope), Skill.project_uuid.is_(None)))
    skills = q.order_by(Skill.name).all()
    result = []
    for s in skills:
        out = SkillOut.model_validate(s).model_dump()
        out["employee_count"] = db.query(EmployeeSkill).filter(EmployeeSkill.skill_id == s.id).count()
        result.append(out)
    return result


@router.post("", response_model=SkillOut, status_code=201)
def create_skill(body: SkillCreate, db: Session = Depends(get_db), current_user=Depends(require_manager)):
    if getattr(body, "project_uuid", None):
        check_project_access(body.project_uuid, current_user, db)
    skill = Skill(**body.model_dump())
    db.add(skill)
    db.commit()
    db.refresh(skill)
    out = SkillOut.model_validate(skill).model_dump()
    out["employee_count"] = 0
    return out


@router.get("/{skill_id}", response_model=SkillOut)
def get_skill(skill_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if not skill:
        raise HTTPException(404, detail="Не найден")
    if skill.project_uuid:
        check_project_access(skill.project_uuid, current_user, db)
    out = SkillOut.model_validate(skill).model_dump()
    out["employee_count"] = db.query(EmployeeSkill).filter(EmployeeSkill.skill_id == skill_id).count()
    return out


@router.put("/{skill_id}", response_model=SkillOut)
def update_skill(skill_id: int, body: SkillUpdate, db: Session = Depends(get_db), current_user=Depends(require_manager)):
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if not skill:
        raise HTTPException(404, detail="Не найден")
    if skill.project_uuid:
        check_project_access(skill.project_uuid, current_user, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(skill, k, v)
    db.commit()
    db.refresh(skill)
    out = SkillOut.model_validate(skill).model_dump()
    out["employee_count"] = db.query(EmployeeSkill).filter(EmployeeSkill.skill_id == skill_id).count()
    return out


@router.delete("/{skill_id}", status_code=204)
def delete_skill(skill_id: int, db: Session = Depends(get_db), current_user=Depends(require_manager)):
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if not skill:
        raise HTTPException(404, detail="Не найден")
    if skill.project_uuid:
        check_project_access(skill.project_uuid, current_user, db)
    db.delete(skill)
    db.commit()


@router.post("/seed")
def seed_default_skills(db: Session = Depends(get_db), _=Depends(require_manager)):
    added = 0
    for name, code, description in DEFAULT_SKILLS:
        if not db.query(Skill).filter(Skill.code == code).first():
            db.add(Skill(name=name, code=code, description=description))
            added += 1
    db.commit()
    return {"ok": True, "added": added}

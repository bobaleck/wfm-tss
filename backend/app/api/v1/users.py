from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.security import get_password_hash
from app.models.user import User
from app.models.audit import UserProject
from app.schemas.user import UserCreate, UserUpdate, UserOut
from app.api.deps import get_current_user, require_admin

router = APIRouter()


@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(User).order_by(User.full_name).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="Пользователь уже существует")
    user = User(
        username=body.username,
        email=body.email,
        full_name=body.full_name,
        role=body.role,
        is_active=body.is_active,
        is_superuser=body.is_superuser,
        hashed_password=get_password_hash(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, detail="Не найден")
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, detail="Не найден")
    data = body.model_dump(exclude_unset=True)
    if "password" in data:
        user.hashed_password = get_password_hash(data.pop("password"))
    for k, v in data.items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db),
                current_user: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, detail="Не найден")
    if user.id == current_user.id:
        raise HTTPException(400, detail="Нельзя удалить себя")
    db.delete(user)
    db.commit()


# ─── User-project assignments ─────────────────────────────────────────────────

@router.get("/{user_id}/projects")
def get_user_projects(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    rows = db.query(UserProject).filter(UserProject.user_id == user_id).all()
    return [{"project_uuid": r.project_uuid} for r in rows]


@router.post("/{user_id}/projects")
def assign_project(user_id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    project_uuid = body.get("project_uuid")
    if not project_uuid:
        raise HTTPException(400, detail="project_uuid обязателен")
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(404, detail="Пользователь не найден")
    existing = db.query(UserProject).filter(
        UserProject.user_id == user_id, UserProject.project_uuid == project_uuid
    ).first()
    if not existing:
        db.add(UserProject(user_id=user_id, project_uuid=project_uuid))
        db.commit()
    return {"ok": True, "user_id": user_id, "project_uuid": project_uuid}


@router.delete("/{user_id}/projects/{project_uuid}")
def remove_project(user_id: int, project_uuid: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    row = db.query(UserProject).filter(
        UserProject.user_id == user_id, UserProject.project_uuid == project_uuid
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.audit import UserProject

bearer = HTTPBearer(auto_error=False)

# Roles ordered by privilege level (highest first)
ROLE_HIERARCHY = ['admin', 'project_manager', 'analyst', 'hr', 'customer', 'viewer']

# Roles that have access to ALL projects (no project-level filter)
ALL_PROJECTS_ROLES = {'admin', 'analyst', 'hr', 'viewer'}

# Roles that see only their assigned projects
PROJECT_SCOPED_ROLES = {'project_manager', 'customer'}


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Не авторизован")
    username = decode_token(credentials.credentials)
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Недействительный токен")
    user = db.query(User).filter(User.username == username, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь не найден")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("admin",) and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет прав")
    return current_user


def require_manager(current_user: User = Depends(get_current_user)) -> User:
    """Allows admin and project_manager."""
    if current_user.role not in ("admin", "project_manager") and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет прав")
    return current_user


def require_analyst(current_user: User = Depends(get_current_user)) -> User:
    """Allows admin, project_manager, and analyst."""
    if current_user.role not in ("admin", "project_manager", "analyst") and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет прав")
    return current_user


def require_hr(current_user: User = Depends(get_current_user)) -> User:
    """Allows admin, project_manager, hr."""
    if current_user.role not in ("admin", "project_manager", "hr") and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет прав")
    return current_user


def check_project_access(partner_uuid: str, current_user: User, db: Session) -> None:
    """Raise 403 if current_user has no access to partner_uuid."""
    if current_user.is_superuser or current_user.role in ALL_PROJECTS_ROLES:
        return
    if current_user.role in PROJECT_SCOPED_ROLES:
        assigned = db.query(UserProject).filter(
            UserProject.user_id == current_user.id,
            UserProject.project_uuid == partner_uuid,
        ).first()
        if not assigned:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет доступа к проекту")


def get_user_project_uuids(user: User, db: Session) -> list[str] | None:
    """Returns list of project UUIDs the user can access, or None meaning 'all projects'."""
    if user.is_superuser or user.role in ALL_PROJECTS_ROLES:
        return None  # all projects
    rows = db.query(UserProject).filter(UserProject.user_id == user.id).all()
    return [r.project_uuid for r in rows]

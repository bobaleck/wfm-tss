from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.core.database import get_db
from app.models.team import Team, TeamUser
from app.models.employee import Employee
from app.schemas.team import TeamCreate, TeamUpdate, TeamOut, TeamTreeNode
from app.api.deps import get_current_user, require_manager

router = APIRouter()


def _set_user_links(team: Team, user_ids: list, db: Session) -> None:
    """Перезаписывает привязку команды к пользователям (для отображения)."""
    db.query(TeamUser).filter(TeamUser.team_id == team.id).delete()
    for uid in dict.fromkeys(user_ids or []):  # уникальные, сохраняя порядок
        db.add(TeamUser(team_id=team.id, user_id=uid))


def _enrich(t: Team, db: Session) -> dict:
    out = TeamOut.model_validate(t).model_dump()
    out["employee_count"] = db.query(Employee).filter(Employee.team_id == t.id).count()
    out["parent_name"] = t.parent.name if t.parent else None
    out["leader_name"] = t.leader.full_name if t.leader else None
    out["leader_user_name"] = (t.leader_user.full_name or t.leader_user.username) if t.leader_user else None
    links = t.user_links or []
    out["user_ids"] = [lk.user_id for lk in links]
    out["user_names"] = [(lk.user.full_name or lk.user.username) for lk in links if lk.user]
    return out


def _build_tree(teams: List[Team], parent_id, db: Session) -> List[dict]:
    nodes = []
    for t in teams:
        if t.parent_id == parent_id:
            node = _enrich(t, db)
            node["children"] = _build_tree(teams, t.id, db)
            nodes.append(node)
    return nodes


@router.get("", response_model=List[TeamOut])
def list_teams(project_uuid: Optional[str] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(Team)
    if project_uuid:
        q = q.filter(Team.project_uuid == project_uuid)
    teams = q.order_by(Team.name).all()
    return [_enrich(t, db) for t in teams]


@router.get("/tree", response_model=List[TeamTreeNode])
def teams_tree(project_uuid: Optional[str] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(Team)
    if project_uuid:
        q = q.filter(Team.project_uuid == project_uuid)
    all_teams = q.all()
    return _build_tree(all_teams, None, db)


@router.post("", response_model=TeamOut, status_code=201)
def create_team(body: TeamCreate, db: Session = Depends(get_db), _=Depends(require_manager)):
    data = body.model_dump()
    user_ids = data.pop("user_ids", []) or []
    team = Team(**data)
    db.add(team)
    db.commit()
    db.refresh(team)
    _set_user_links(team, user_ids, db)
    db.commit()
    db.refresh(team)
    return _enrich(team, db)


@router.get("/{team_id}", response_model=TeamOut)
def get_team(team_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(404, detail="Не найдена")
    return _enrich(team, db)


@router.put("/{team_id}", response_model=TeamOut)
def update_team(team_id: int, body: TeamUpdate, db: Session = Depends(get_db), _=Depends(require_manager)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(404, detail="Не найдена")
    data = body.model_dump(exclude_unset=True)
    user_ids = data.pop("user_ids", None)
    for k, v in data.items():
        setattr(team, k, v)
    if user_ids is not None:
        _set_user_links(team, user_ids, db)
    db.commit()
    db.refresh(team)
    return _enrich(team, db)


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: int, db: Session = Depends(get_db), _=Depends(require_manager)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(404, detail="Не найдена")
    db.delete(team)
    db.commit()

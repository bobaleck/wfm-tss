from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

TEAM_TYPE_LABELS = {
    'group': 'Группа операторов',
    'department': 'Отдел',
    'division': 'Управление',
}


class TeamBase(BaseModel):
    name: str
    project_uuid: Optional[str] = None
    parent_id: Optional[int] = None
    team_type: str = "group"
    leader_id: Optional[int] = None
    description: Optional[str] = None


class TeamCreate(TeamBase):
    pass


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    project_uuid: Optional[str] = None
    parent_id: Optional[int] = None
    team_type: Optional[str] = None
    leader_id: Optional[int] = None
    description: Optional[str] = None


class TeamOut(TeamBase):
    id: int
    created_at: datetime
    employee_count: int = 0
    parent_name: Optional[str] = None
    leader_name: Optional[str] = None

    class Config:
        from_attributes = True


class TeamTreeNode(TeamOut):
    children: List["TeamTreeNode"] = []

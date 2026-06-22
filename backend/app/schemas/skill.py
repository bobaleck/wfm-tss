from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SkillBase(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    project_uuid: Optional[str] = None


class SkillCreate(SkillBase):
    pass


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    project_uuid: Optional[str] = None


class SkillOut(SkillBase):
    id: int
    created_at: datetime
    employee_count: int = 0

    class Config:
        from_attributes = True

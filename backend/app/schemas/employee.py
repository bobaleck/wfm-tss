from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

SCHEDULE_CHOICES = ['2/2', '5/2', '7/7', 'Гибкий']
STATUS_CHOICES = ['new', 'active', 'fired']


class SkillRef(BaseModel):
    skill_id: int
    level: int = 1


class EmployeeBase(BaseModel):
    full_name: str
    preferred_schedule: Optional[str] = None
    employment_status: str = 'new'
    project_uuid: Optional[str] = None
    team_id: Optional[int] = None
    position: Optional[str] = None
    naumen_login: Optional[str] = None
    employee_uuid: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool = True


class EmployeeCreate(EmployeeBase):
    skill_ids: Optional[List[int]] = []


class EmployeeUpdate(BaseModel):
    full_name: Optional[str] = None
    preferred_schedule: Optional[str] = None
    employment_status: Optional[str] = None
    project_uuid: Optional[str] = None
    team_id: Optional[int] = None
    position: Optional[str] = None
    naumen_login: Optional[str] = None
    employee_uuid: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None
    skill_ids: Optional[List[int]] = None


class EmployeeSkillOut(BaseModel):
    skill_id: int
    skill_name: str
    level: int

    class Config:
        from_attributes = True


class EmployeeOut(EmployeeBase):
    id: int
    created_at: datetime
    team_name: Optional[str] = None
    skills: List[EmployeeSkillOut] = []

    class Config:
        from_attributes = True

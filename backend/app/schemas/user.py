from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class UserBase(BaseModel):
    username: str
    email: str
    full_name: Optional[str] = None
    role: str = "viewer"
    is_active: bool = True
    is_superuser: bool = False


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    active_project_uuid: Optional[str] = None


class UserOut(UserBase):
    id: int
    active_project_uuid: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date


class ScheduleBase(BaseModel):
    name: str
    project_uuid: Optional[str] = None
    schedule_type: str = "regular"
    work_start: Optional[str] = None
    work_end: Optional[str] = None
    break_duration: int = 60
    days_of_week: str = "12345"
    is_floating: bool = False
    floating_days: Optional[int] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None
    description: Optional[str] = None


class ScheduleCreate(ScheduleBase):
    pass


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    project_uuid: Optional[str] = None
    schedule_type: Optional[str] = None
    work_start: Optional[str] = None
    work_end: Optional[str] = None
    break_duration: Optional[int] = None
    days_of_week: Optional[str] = None
    is_floating: Optional[bool] = None
    floating_days: Optional[int] = None
    lunch_start: Optional[str] = None
    lunch_end: Optional[str] = None
    description: Optional[str] = None


class ScheduleOut(ScheduleBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class ShiftBase(BaseModel):
    employee_id: int
    schedule_id: Optional[int] = None
    shift_date: date
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    lunch_minutes: Optional[int] = None
    lunch_start: Optional[str] = None
    status: str = "planned"
    notes: Optional[str] = None


class ShiftCreate(ShiftBase):
    pass


class ShiftUpdate(BaseModel):
    # shift_date обязателен для переноса смены на другую дату — без него
    # редактирование даты молча игнорировалось (поля не было в схеме), и смена
    # не «переезжала» в раздел «Запланировано».
    shift_date: Optional[date] = None
    schedule_id: Optional[int] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    lunch_minutes: Optional[int] = None
    lunch_start: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    actual_start_time: Optional[str] = None
    actual_end_time: Optional[str] = None
    actual_hours_worked: Optional[str] = None
    needs_review: Optional[bool] = None


class ShiftConfirm(BaseModel):
    actual_start_time: Optional[str] = None
    actual_end_time: Optional[str] = None
    actual_hours_worked: Optional[str] = None


class ShiftOut(ShiftBase):
    id: int
    created_at: datetime
    employee_name: Optional[str] = None
    schedule_name: Optional[str] = None
    actual_start_time: Optional[str] = None
    actual_end_time: Optional[str] = None
    actual_hours_worked: Optional[str] = None
    needs_review: bool = False
    reconciled_at: Optional[datetime] = None
    team_id: Optional[int] = None
    team_name: Optional[str] = None

    class Config:
        from_attributes = True


class AbsenceBase(BaseModel):
    employee_id: int
    absence_type: str
    start_date: date
    end_date: date
    approved: bool = False
    notes: Optional[str] = None


class AbsenceCreate(AbsenceBase):
    pass


class AbsenceUpdate(BaseModel):
    absence_type: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    approved: Optional[bool] = None
    notes: Optional[str] = None


class AbsenceOut(AbsenceBase):
    id: int
    created_at: datetime
    employee_name: Optional[str] = None

    class Config:
        from_attributes = True

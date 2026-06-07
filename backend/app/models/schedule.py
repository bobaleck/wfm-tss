from sqlalchemy import Column, Integer, String, DateTime, Date, Boolean, ForeignKey, Text, Time, func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    project_uuid = Column(String(50))
    schedule_type = Column(String(50), default="regular")  # regular, shift
    work_start = Column(String(10))  # HH:MM
    work_end = Column(String(10))    # HH:MM
    break_duration = Column(Integer, default=60)  # minutes
    days_of_week = Column(String(20), default="12345")  # 1=Mon..7=Sun
    description = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    shifts = relationship("Shift", back_populates="schedule")


class Shift(Base):
    __tablename__ = "shifts"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"))
    schedule_id = Column(Integer, ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True)
    shift_date = Column(Date, nullable=False)
    start_time = Column(String(20))   # ISO datetime string
    end_time = Column(String(20))
    status = Column(String(50), default="planned")  # planned, confirmed, completed, cancelled
    notes = Column(Text)
    # Фактически отработанное время (заполняется при сверке или вручную)
    actual_start_time = Column(String(20), nullable=True)
    actual_end_time = Column(String(20), nullable=True)
    actual_hours_worked = Column(String(10), nullable=True)  # e.g. "7.5"
    needs_review = Column(Boolean, default=False)
    reconciled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    employee = relationship("Employee", back_populates="shifts")
    schedule = relationship("Schedule", back_populates="shifts")


class Absence(Base):
    __tablename__ = "absences"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"))
    absence_type = Column(String(50))  # vacation, sick, personal, training, other
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    approved = Column(Boolean, default=False)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    employee = relationship("Employee", back_populates="absences")

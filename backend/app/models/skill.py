from sqlalchemy import Column, Integer, String, DateTime, Text, func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    code = Column(String(50))
    description = Column(Text)
    project_uuid = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())

    employee_skills = relationship("EmployeeSkill", back_populates="skill", cascade="all, delete-orphan")

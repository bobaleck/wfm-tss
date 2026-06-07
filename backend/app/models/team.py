from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    project_uuid = Column(String(50))
    parent_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    # group=Группа операторов, department=Отдел, division=Управление
    team_type = Column(String(50), default="group")
    leader_id = Column(Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    description = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    parent = relationship("Team", remote_side="Team.id", backref="children")
    employees = relationship("Employee", back_populates="team", foreign_keys="[Employee.team_id]")
    leader = relationship("Employee", foreign_keys="[Team.leader_id]")

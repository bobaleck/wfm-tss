from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UniqueConstraint, func
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
    # «Руководитель» команды теперь — Пользователь системы (а не сотрудник).
    # По нему же работает фильтр «Мои команды» в проставлении смен.
    leader_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    description = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    parent = relationship("Team", remote_side="Team.id", backref="children")
    employees = relationship("Employee", back_populates="team", foreign_keys="[Employee.team_id]")
    leader = relationship("Employee", foreign_keys="[Team.leader_id]")
    leader_user = relationship("User", foreign_keys="[Team.leader_user_id]")
    user_links = relationship("TeamUser", cascade="all, delete-orphan", back_populates="team")


class TeamUser(Base):
    """Привязка команды к пользователям (для отображения). Команда может быть
    привязана к нескольким пользователям одновременно."""
    __tablename__ = "team_users"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_user"),)

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    team = relationship("Team", back_populates="user_links")
    user = relationship("User")

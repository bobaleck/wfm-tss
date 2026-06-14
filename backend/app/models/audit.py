from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, func
from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    username = Column(String(100))
    action = Column(String(100))
    resource = Column(String(100))
    resource_id = Column(String(50))
    details = Column(JSON)
    ip_address = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())


class IntegrationSettings(Base):
    __tablename__ = "integration_settings"

    id = Column(Integer, primary_key=True, index=True)
    db_host = Column(String(200))
    db_name = Column(String(100))
    db_user = Column(String(100))
    db_password = Column(String(200))
    db_port = Column(Integer, default=5432)
    api_base_url = Column(String(200))
    api_username = Column(String(100))
    api_key = Column(String(200))
    is_active = Column(Integer, default=1)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TrackedProject(Base):
    __tablename__ = "tracked_projects"

    id = Column(Integer, primary_key=True, index=True)
    customer_uuid = Column(String(100), unique=True, index=True, nullable=False)
    customer_name = Column(String(200), nullable=False)
    customer_type = Column(String(100))
    responsible_manager = Column(String(200))
    target_sl = Column(Integer, nullable=True)          # целевой SL% для проекта
    is_manual = Column(Integer, default=0)              # 1 = добавлен вручную (не из Naumen)
    added_at = Column(DateTime, server_default=func.now())


class QueueSetting(Base):
    __tablename__ = "queue_settings"

    id = Column(Integer, primary_key=True, index=True)
    partner_uuid = Column(String(100), nullable=False, index=True)
    queue_name = Column(String(300), nullable=False)
    target_sl = Column(Integer, nullable=True)
    answer_sec = Column(Integer, nullable=True)

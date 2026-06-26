from sqlalchemy import Column, Integer, String, DateTime, Date, Boolean, ForeignKey, JSON, UniqueConstraint, func
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
    # Виды деятельности (линии) проекта: входящая и/или исходящая. От них зависит,
    # какие разделы аналитики показываются («Аналитика (Вход)» / «Аналитика (Исход)»).
    has_inbound = Column(Boolean, default=True)
    has_outbound = Column(Boolean, default=False)
    added_at = Column(DateTime, server_default=func.now())


class QueueSetting(Base):
    __tablename__ = "queue_settings"

    id = Column(Integer, primary_key=True, index=True)
    partner_uuid = Column(String(100), nullable=False, index=True)
    queue_name = Column(String(300), nullable=False)
    target_sl = Column(Integer, nullable=True)
    answer_sec = Column(Integer, nullable=True)
    # Время постобработки (ПВО), допустимое для очереди, сек — настраивается вручную.
    wrapup_sec = Column(Integer, nullable=True)
    # Отображение очереди: во «Вход», в «Исход» и/или скрыть. Проставляются по
    # умолчанию при добавлении (вход=да), но руководитель может переназначить.
    show_in = Column(Boolean, default=True)
    show_out = Column(Boolean, default=False)
    hidden = Column(Boolean, default=False)


class StatusConfig(Base):
    """Классификация нестандартных статусов Naumen — индивидуально для каждого проекта."""
    __tablename__ = "status_configs"
    __table_args__ = (UniqueConstraint("project_uuid", "status_name", name="uq_status_project"),)

    id = Column(Integer, primary_key=True, index=True)
    project_uuid = Column(String(100), nullable=False, index=True)
    status_name = Column(String(100), nullable=False, index=True)
    classification = Column(String(20), nullable=False, default='pause')  # work | pause | offline
    label = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class CustomerDemand(Base):
    """Потребность операторов «от заказчика», загруженная из Excel: на каждый
    день и час — требуемое число операторов. Количество дней произвольное."""
    __tablename__ = "customer_demand"
    __table_args__ = (UniqueConstraint("project_uuid", "demand_date", "hour", name="uq_customer_demand"),)

    id = Column(Integer, primary_key=True, index=True)
    project_uuid = Column(String(100), nullable=False, index=True)
    demand_date = Column(Date, nullable=False, index=True)
    hour = Column(Integer, nullable=False)
    required = Column(Integer, nullable=False, default=0)
    uploaded_at = Column(DateTime, server_default=func.now())


class UserProject(Base):
    """Maps users (project_manager / customer roles) to their allowed projects."""
    __tablename__ = "user_projects"
    __table_args__ = (UniqueConstraint("user_id", "project_uuid", name="uq_user_project"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_uuid = Column(String(100), nullable=False, index=True)
    added_at = Column(DateTime, server_default=func.now())

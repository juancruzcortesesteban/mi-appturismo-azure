"""
Modelos de Base de Datos SQLAlchemy
Turismo Inteligente - Colombia
"""
from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    Enum,
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50, collation="NOCASE"), unique=True, nullable=False)
    description = Column(String(255), nullable=False, default="")
    permissions = relationship(
        "Permission",
        secondary="role_permissions",
        back_populates="roles",
    )


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    description = Column(String(255), nullable=False, default="")
    roles = relationship(
        "Role",
        secondary="role_permissions",
        back_populates="permissions",
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id = Column(Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    # Roles RBAC: SuperAdmin, Administrador, Auditor, Comerciante, Turista.
    role = Column(String(50, collation="NOCASE"), ForeignKey("roles.name"), nullable=False, default="Turista")
    permisos = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    account_locked_until = Column(DateTime, nullable=True)
    current_session_token_id = Column(String(36), nullable=True)
    last_activity_at = Column(DateTime, nullable=True)
    security_question = Column(String(255), nullable=True)
    security_answer_hash = Column(String(255), nullable=True)
    two_factor_enabled = Column(Boolean, nullable=False, default=False)
    two_factor_secret = Column(String(64), nullable=True)
    two_factor_challenge_id = Column(String(36), nullable=True)
    role_definition = relationship("Role", foreign_keys=[role], primaryjoin="User.role == Role.name")
    permission_overrides = relationship(
        "UserPermission",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    @property
    def effective_permissions(self) -> list[str]:
        inherited = {
            permission.name for permission in (self.role_definition.permissions if self.role_definition else [])
        }
        for override in self.permission_overrides:
            if override.granted:
                inherited.add(override.permission.name)
            else:
                inherited.discard(override.permission.name)
        return sorted(inherited)

    # Relaciones
    places = relationship("Place", back_populates="merchant", cascade="all, delete-orphan")
    favorites = relationship("Favorite", back_populates="user", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="user", cascade="all, delete-orphan")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    event = Column(String(100), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    ip_address = Column(String(45), nullable=True)
    status = Column(String(20), nullable=False)
    is_suspicious = Column(Boolean, default=False, nullable=False, index=True)
    alert_reason = Column(String(255), nullable=True)
    details = Column(Text, nullable=True)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    used_at = Column(DateTime, nullable=True)


class UserPermission(Base):
    __tablename__ = "user_permissions"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    permission_id = Column(Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)
    granted = Column(Boolean, nullable=False)
    user = relationship("User", back_populates="permission_overrides")
    permission = relationship("Permission")


class Place(Base):
    __tablename__ = "places"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=False)
    category = Column(String(100), nullable=False, index=True)  # Aventura, Cultural, Histórico, etc.
    department = Column(String(100), nullable=False, index=True)  # Boyacá, Bolívar, etc.
    city = Column(String(100), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    entry_fee = Column(Float, default=0.0)
    rating = Column(Float, default=5.0)
    image_url = Column(String(500), nullable=True)
    is_verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Identificador del comerciante propietario
    merchant_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relaciones
    merchant = relationship("User", back_populates="places")
    favorites = relationship("Favorite", back_populates="place", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="place", cascade="all, delete-orphan")


class Favorite(Base):
    __tablename__ = "favorites"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    place_id = Column(Integer, ForeignKey("places.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="favorites")
    place = relationship("Place", back_populates="favorites")


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    place_id = Column(Integer, ForeignKey("places.id"), nullable=False)
    rating = Column(Float, nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="reviews")
    place = relationship("Place", back_populates="reviews")

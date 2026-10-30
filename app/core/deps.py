"""
Sistema de Dependencias y Control de Acceso Basado en Roles (RBAC) Estricto
Turismo Inteligente - Colombia
"""
from enum import Enum
from datetime import datetime, timedelta
import os
from typing import Optional
from fastapi import Depends, HTTPException, Request, Response, Security, status
from fastapi.security import OAuth2PasswordBearer, HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.security import SECRET_KEY, ALGORITHM
from app.core.audit import record_audit_event
from app.db.session import get_db
from app.db.models import Permission, Role, RolePermission, User, UserPermission

# Esquema de autenticación Bearer
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
http_bearer = HTTPBearer(auto_error=False)


class UserRole(str, Enum):
    SUPER_ADMIN = "SuperAdmin"
    ADMIN = "Administrador"
    AUDITOR = "Auditor"
    MERCHANT = "Comerciante"
    TOURIST = "Turista"


SESSION_IDLE_TIMEOUT = timedelta(minutes=15)


def _session_cookie_headers(request: Request) -> dict[str, str]:
    cookie_response = Response(status_code=status.HTTP_401_UNAUTHORIZED)
    cookie_response.delete_cookie(
        key="access_token",
        httponly=True,
        secure=(
            request.url.scheme == "https"
            or os.getenv("COOKIE_SECURE", "false").strip().lower() == "true"
            or os.getenv("APP_ENV", "development").strip().lower() == "production"
        ),
        samesite="lax",
        path="/",
    )
    cookie_headers = cookie_response.headers.getlist("set-cookie")
    return {"set-cookie": cookie_headers[0]} if cookie_headers else {}


def _unauthorized(request: Request, detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={
            "WWW-Authenticate": "Bearer",
            **_session_cookie_headers(request),
        },
    )


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    auth_header: Optional[HTTPAuthorizationCredentials] = Security(http_bearer),
) -> User:
    """
    Extrae y valida el JWT token. Retorna la instancia de usuario autenticado.
    Lanza 401 si no hay credenciales o son inválidas.
    """
    invalid_credentials_detail = "No se pudieron validar las credenciales de acceso."
    token = auth_header.credentials if auth_header else request.cookies.get("access_token")
    if not token:
        raise _unauthorized(request, invalid_credentials_detail)
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        session_id: str = payload.get("session_id")
        if email is None or session_id is None:
            raise _unauthorized(request, "La sesión no es válida. Inicia sesión nuevamente.")
    except JWTError:
        raise _unauthorized(request, invalid_credentials_detail)

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise _unauthorized(request, "Usuario inactivo o no encontrado en el sistema.")

    if user.current_session_token_id != session_id:
        raise _unauthorized(
            request,
            "Esta sesión fue reemplazada por un inicio de sesión en otro dispositivo.",
        )

    now = datetime.utcnow()
    if user.last_activity_at is None or now - user.last_activity_at >= SESSION_IDLE_TIMEOUT:
        raise _unauthorized(request, "La sesión expiró por inactividad. Inicia sesión nuevamente.")

    user.last_activity_at = now
    db.commit()
    return user


def get_current_active_user_optional(
    request: Request,
    db: Session = Depends(get_db),
    auth_header: Optional[HTTPAuthorizationCredentials] = Security(http_bearer),
) -> Optional[User]:
    """Permite el acceso a endpoints públicos pero identifica al usuario si está logueado."""
    if not auth_header and not request.cookies.get("access_token"):
        return None
    try:
        return get_current_user(request=request, db=db, auth_header=auth_header)
    except HTTPException:
        return None


def user_has_permission(db: Session, user: User, permission_name: str) -> bool:
    override = (
        db.query(UserPermission.granted)
        .join(Permission, Permission.id == UserPermission.permission_id)
        .filter(
            UserPermission.user_id == user.id,
            Permission.name == permission_name,
        )
        .first()
    )
    if override is not None:
        return bool(override[0])

    return (
        db.query(RolePermission.role_id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .filter(Role.name == user.role, Permission.name == permission_name)
        .first()
        is not None
    )


class PermissionChecker:
    def __init__(self, permission_name: str):
        self.permission_name = permission_name

    def __call__(
        self,
        request: Request,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        if user_has_permission(db, current_user, self.permission_name):
            return current_user

        path = request.url.path
        is_admin_endpoint = (
            path.startswith("/api/v1/admin/")
            or path.startswith("/api/v1/auth/users")
            or path == "/api/v1/system/source-code"
            or (path.startswith("/api/v1/places/") and path.endswith("/status"))
        )
        if is_admin_endpoint:
            record_audit_event(
                db,
                request,
                user_id=current_user.id,
                email=current_user.email,
                event="Intento de acceso administrativo",
                status="Fallido",
                is_suspicious=True,
                alert_reason="Alerta de Intrusión",
                details=f"{request.method} {path}; permiso requerido={self.permission_name}",
            )
            db.commit()

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Acceso denegado: falta el permiso '{self.permission_name}'.",
        )


def require_permission(permission_name: str) -> PermissionChecker:
    return PermissionChecker(permission_name)


require_admin = require_permission("access_admin")
require_admin_or_auditor = require_permission("access_admin")
require_super_admin = require_permission("manage_roles")
require_super_admin_or_auditor = require_permission("access_rbac")
require_merchant = require_permission("access_merchant")
require_merchant_or_admin = require_permission("write_operations")
require_merchant_portal_read = require_permission("access_merchant")
require_authenticated = require_permission("read_only")

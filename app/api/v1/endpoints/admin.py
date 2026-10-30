from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.audit import record_audit_event, record_auditor_read
from app.core.deps import (
    require_admin_or_auditor,
    require_permission,
    require_super_admin,
    user_has_permission,
)
from app.core.security import get_password_hash
from app.db.models import AuditLog, Permission, Role, RolePermission, User, UserPermission
from app.db.session import get_db
from app.schemas.auth import AdminPasswordResetRequest, RoleCreate, UserPermissionsUpdate

router = APIRouter()
PRIVILEGED_PERMISSIONS = {"manage_roles", "manage_users"}
PROTECTED_SYSTEM_ROLES = {
    "superadmin",
    "administrador",
    "comerciante",
    "turista",
    "auditor",
}


@router.get("/security-logs")
def read_security_logs(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_auditor),
):
    """Return recent audit activity and security metrics to SuperAdmin or Auditor."""
    now_utc = datetime.now(timezone.utc)
    now_utc_naive = now_utc.replace(tzinfo=None)
    colombia_timezone = timezone(timedelta(hours=-5))
    colombia_now = now_utc.astimezone(colombia_timezone)
    local_day_start = datetime.combine(
        colombia_now.date(),
        time.min,
        tzinfo=colombia_timezone,
    )
    today_start_utc = local_day_start.astimezone(timezone.utc).replace(tzinfo=None)
    alerts_since = now_utc_naive - timedelta(hours=24)

    login_count_today = (
        db.query(AuditLog)
        .filter(
            AuditLog.event == "Inicio de Sesión",
            AuditLog.status == "Exitoso",
            AuditLog.timestamp >= today_start_utc,
        )
        .count()
    )
    active_alerts = (
        db.query(AuditLog)
        .filter(AuditLog.is_suspicious.is_(True), AuditLog.timestamp >= alerts_since)
        .count()
    )
    recent_logs = (
        db.query(AuditLog)
        .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .limit(250)
        .all()
    )

    response = {
        "total_users": db.query(User).count(),
        "logins_today": login_count_today,
        "active_alerts": active_alerts,
        "logs": [
            {
                "id": entry.id,
                "user_id": entry.user_id,
                "email": entry.email,
                "event": entry.event,
                "timestamp": entry.timestamp.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                "ip_address": entry.ip_address,
                "status": entry.status,
                "is_suspicious": entry.is_suspicious,
                "alert_reason": entry.alert_reason,
                "details": entry.details,
            }
            for entry in recent_logs
        ],
    }
    if not user_has_permission(db, current_user, "manage_users"):
        record_auditor_read(db, request, current_user, "Administración")
    return response


@router.get("/auditor-read-logs", dependencies=[Depends(require_super_admin)])
def read_auditor_read_logs(db: Session = Depends(get_db)):
    """Return successful read events performed by authorized Auditor accounts."""
    entries = (
        db.query(AuditLog, User.full_name)
        .outerjoin(User, AuditLog.user_id == User.id)
        .filter(
            AuditLog.event == "AUDITOR_READ",
            AuditLog.status == "Exitoso",
        )
        .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .limit(500)
        .all()
    )
    return [
        {
            "id": entry.id,
            "timestamp": entry.timestamp.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
            "auditor_name": full_name or entry.email,
            "email": entry.email,
            "module": (
                entry.details.partition("module=")[2].partition(";")[0]
                if entry.details and "module=" in entry.details
                else "Desconocido"
            ),
        }
        for entry, full_name in entries
    ]


@router.get("/roles")
def list_roles(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("access_admin")),
):
    roles = (
        db.query(Role)
        .options(joinedload(Role.permissions))
        .order_by(Role.name.collate("NOCASE"))
        .all()
    )
    permissions = db.query(Permission).order_by(Permission.name).all()
    return {
        "roles": [
            {
                "id": role.id,
                "name": role.name,
                "description": role.description,
                "permission_ids": sorted(permission.id for permission in role.permissions),
                "permissions": sorted(permission.name for permission in role.permissions),
            }
            for role in roles
        ],
        "permissions": [
            {"id": permission.id, "name": permission.name, "description": permission.description}
            for permission in permissions
        ],
        "can_manage_roles": user_has_permission(db, current_user, "manage_roles"),
    }


@router.post("/roles", status_code=status.HTTP_201_CREATED)
def create_role(
    role_data: RoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    role_name = role_data.name.strip()
    if not role_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El nombre del rol no puede estar vacío.",
        )
    if db.query(Role.id).filter(Role.name == role_name).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un rol con ese nombre.",
        )

    permissions = (
        db.query(Permission)
        .filter(Permission.id.in_(set(role_data.permission_ids)))
        .all()
        if role_data.permission_ids
        else []
    )
    if len(permissions) != len(set(role_data.permission_ids)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uno o más permisos seleccionados no existen.",
        )
    if any(permission.name in PRIVILEGED_PERMISSIONS for permission in permissions):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Los permisos de administración de roles y usuarios no se pueden delegar.",
        )

    role = Role(name=role_name, description=role_data.description.strip())
    role.permissions = permissions
    db.add(role)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un rol con ese nombre.",
        ) from error
    db.refresh(role)
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "permission_ids": sorted(permission.id for permission in role.permissions),
        "permissions": sorted(permission.name for permission in role.permissions),
    }


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontró el rol solicitado.",
        )
    if role.name.casefold() in PROTECTED_SYSTEM_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pueden eliminar los roles protegidos por defecto del sistema",
        )

    default_role = db.query(Role).filter(Role.name == "Turista").first()
    if default_role is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se encontró el rol predeterminado Turista para reasignar usuarios.",
        )

    assigned_users = db.query(User).filter(User.role == role.name).all()
    for user in assigned_users:
        user.role = default_role.name

    role_name = role.name
    reassigned_count = len(assigned_users)
    record_audit_event(
        db,
        request,
        user_id=current_user.id,
        email=current_user.email,
        event="CUSTOM_ROLE_DELETED",
        status="Exitoso",
        details=(
            f"SuperAdmin eliminó el rol personalizado '{role_name}'; "
            f"usuarios reasignados a Turista={reassigned_count}."
        ),
    )
    db.delete(role)
    db.commit()
    return {
        "role_id": role_id,
        "role_name": role_name,
        "reassigned_users": reassigned_count,
    }


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    reset_data: AdminPasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("manage_users")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontró el usuario solicitado.",
        )

    user.hashed_password = get_password_hash(reset_data.password)
    user.current_session_token_id = None
    user.last_activity_at = None
    record_audit_event(
        db,
        request,
        user_id=current_user.id,
        email=current_user.email,
        event="ADMIN_PASSWORD_RESET",
        status="Exitoso",
        details=f"Administrador {current_user.id} restableció la contraseña del usuario {user.id}.",
    )
    db.commit()
    return {"user_id": user.id, "message": "La contraseña se restableció correctamente."}


@router.put("/users/{user_id}/permissions")
def update_user_permissions(
    user_id: int,
    update: UserPermissionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("manage_users")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado.")
    if user_has_privileged_role(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se pueden personalizar los permisos de un usuario con control de SuperAdmin.",
        )

    requested_ids = set(update.permission_ids)
    permissions = (
        db.query(Permission).filter(Permission.id.in_(requested_ids)).all()
        if requested_ids
        else []
    )
    if len(permissions) != len(requested_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uno o más permisos seleccionados no existen.",
        )
    if any(permission.name in PRIVILEGED_PERMISSIONS for permission in permissions):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Los permisos de administración de roles y usuarios no se pueden delegar.",
        )

    inherited_ids = {
        permission.id
        for permission in (
            db.query(Permission.id)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .join(Role, Role.id == RolePermission.role_id)
            .filter(Role.name == user.role)
            .all()
        )
    }
    db.query(UserPermission).filter(UserPermission.user_id == user.id).delete(
        synchronize_session=False
    )
    for permission_id in requested_ids ^ inherited_ids:
        db.add(UserPermission(
            user_id=user.id,
            permission_id=permission_id,
            granted=permission_id in requested_ids,
        ))
    db.commit()
    db.refresh(user)
    return {"user_id": user.id, "role": user.role, "permissions": user.effective_permissions}


def user_has_privileged_role(db: Session, user: User) -> bool:
    return user_has_permission(db, user, "manage_roles")

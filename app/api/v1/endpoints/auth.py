"""
Endpoints de Autenticación, Sesión y Gestión de Usuarios con RBAC
Turismo Inteligente - Colombia
"""
import base64
import io
import json
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
import pyotp
import qrcode
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event, record_auditor_read
from app.core.email import send_reset_password_email
from app.core.deps import (
    get_current_user,
    require_admin,
    require_admin_or_auditor,
    require_permission,
    require_super_admin,
    user_has_permission,
    UserRole,
)
from app.core.security import ALGORITHM, SECRET_KEY, create_access_token, get_password_hash, verify_password
from app.db.models import AuditLog, PasswordResetToken, Permission, Role, User, UserPermission
from app.db.session import get_db
from app.schemas.auth import (
    AdminUserCreate,
    ForgotPasswordRequest,
    LoginResponse,
    ResetPasswordRequest,
    TwoFactorCode,
    TwoFactorSetupResponse,
    UserCreate,
    UserLogin,
    UserResponse,
    UserUpdateRole,
)

router = APIRouter()

MASTER_ADMIN_EMAIL = "admin@turismocolombia.com"
LOGIN_MAX_ATTEMPTS = 5
LOCKOUT_DURATION = timedelta(minutes=15)
RESET_TOKEN_LIFETIME = timedelta(minutes=15)
MFA_PREAUTH_LIFETIME = timedelta(minutes=5)
EMAIL_ALREADY_REGISTERED = "Este correo electrónico ya está registrado"
MASTER_ADMIN_REGISTRATION_ENABLED = (
    os.getenv("ENABLE_MASTER_ADMIN_REGISTRATION", "false").strip().lower() == "true"
)


def should_use_secure_cookie(request: Request) -> bool:
    return (
        request.url.scheme == "https"
        or os.getenv("COOKIE_SECURE", "false").strip().lower() == "true"
        or os.getenv("APP_ENV", "development").strip().lower() == "production"
    )


def duplicate_email_exists(db: Session, email: str) -> bool:
    return (
        db.query(User.id)
        .filter(func.lower(User.email) == email.lower())
        .first()
        is not None
    )


def duplicate_email_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=EMAIL_ALREADY_REGISTERED,
    )


def _set_cookie(
    response: Response,
    request: Request,
    key: str,
    value: str,
    max_age: int,
) -> None:
    response.set_cookie(
        key=key,
        value=value,
        httponly=True,
        secure=should_use_secure_cookie(request),
        samesite="lax",
        max_age=max_age,
        path="/",
    )


def _complete_authenticated_login(
    user: User,
    request: Request,
    response: Response,
    db: Session,
) -> dict[str, object]:
    login_time = datetime.now(timezone.utc).replace(tzinfo=None)
    session_id = str(uuid.uuid4())
    if user.current_session_token_id is not None:
        record_audit_event(
            db,
            request,
            user_id=user.id,
            email=user.email,
            event="CONCURRENT_SESSION_TERMINATED",
            status="Exitoso",
            is_suspicious=True,
            alert_reason="Un nuevo inicio de sesión reemplazó la sesión activa anterior.",
            details="La sesión anterior se invalidó al iniciar sesión en otro navegador o dispositivo.",
            timestamp=login_time,
        )
    user.current_session_token_id = session_id
    user.two_factor_challenge_id = None
    user.last_activity_at = login_time
    colombia_hour = datetime.now(timezone.utc).astimezone(
        timezone(timedelta(hours=-5))
    ).hour
    unusual_hour = 1 <= colombia_hour < 4
    record_audit_event(
        db,
        request,
        user_id=user.id,
        email=user.email,
        event="Inicio de Sesión",
        status="Exitoso",
        is_suspicious=unusual_hour,
        alert_reason=(
            "Inicio de sesión en horario inusual (01:00–04:00, hora de Colombia)."
            if unusual_hour
            else None
        ),
        timestamp=login_time,
    )
    db.commit()

    access_token = create_access_token(
        subject=user.email,
        role=user.role,
        user_id=user.id,
        full_name=user.full_name,
        session_id=session_id,
    )
    _set_cookie(
        response,
        request,
        "access_token",
        access_token,
        max_age=60 * 24 * 60 * 60,
    )
    return {
        "status": "authenticated",
        "token_type": "bearer",
        "role": user.role,
        "user_id": user.id,
        "full_name": user.full_name,
    }


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    """
    Registro público de usuarios.
    Por defecto se asigna el rol 'Turista'.
    Si un usuario desea registrarse como Comerciante, puede solicitarlo en el formulario.
    El correo maestro recibe el rol 'Administrador' automáticamente cuando la regla
    está habilitada explícitamente para pruebas locales.
    """
    if duplicate_email_exists(db, user_in.email):
        raise duplicate_email_error()

    if MASTER_ADMIN_REGISTRATION_ENABLED and user_in.email == MASTER_ADMIN_EMAIL:
        assigned_role = UserRole.ADMIN.value
    else:
        assigned_role = user_in.role.value if user_in.role else UserRole.TOURIST.value
        if assigned_role in (
            UserRole.ADMIN.value,
            UserRole.SUPER_ADMIN.value,
            UserRole.AUDITOR.value,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No está permitido auto-asignar roles privilegiados durante el registro.",
            )

    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name,
        role=assigned_role,
        is_active=True,
    )
    db.add(user)
    if user_in.role == UserRole.AUDITOR.value and user_in.permisos is not None:
        legacy_permission_map = {
            "ver_admin": "access_admin",
            "ver_rbac": "access_rbac",
            "ver_comerciante": "access_merchant",
        }
        for legacy_name, permission_name in legacy_permission_map.items():
            if getattr(user_in.permisos, legacy_name):
                permission = db.query(Permission).filter(
                    Permission.name == permission_name
                ).one()
                user.permission_overrides.append(UserPermission(
                    permission=permission,
                    granted=True,
                ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if duplicate_email_exists(db, user_in.email):
            raise duplicate_email_error()
        raise
    db.refresh(user)
    return user


@router.post(
    "/login",
    response_model=LoginResponse,
    response_model_exclude_none=True,
)
def login(
    login_data: UserLogin,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Autenticación de usuarios por email y contraseña.
    Genera un token JWT con la información de rol para RBAC.
    """
    user = db.query(User).filter(func.lower(User.email) == login_data.email.lower()).first()
    now = datetime.utcnow()
    if user and user.account_locked_until:
        if user.account_locked_until > now:
            seconds_remaining = max(1, int((user.account_locked_until - now).total_seconds()))
            minutes_remaining = (seconds_remaining + 59) // 60
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=f"Cuenta bloqueada temporalmente. Intenta nuevamente en {minutes_remaining} "
                f"{'minuto' if minutes_remaining == 1 else 'minutos'}.",
            )
        user.account_locked_until = None
        user.failed_login_attempts = 0

    if not user or not verify_password(login_data.password, user.hashed_password):
        if user:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= LOGIN_MAX_ATTEMPTS:
                user.account_locked_until = now + LOCKOUT_DURATION
                record_audit_event(
                    db,
                    request,
                    user_id=user.id,
                    email=user.email,
                    event="ACCOUNT_LOCKOUT",
                    status="Fallido",
                    is_suspicious=True,
                    alert_reason="Cinco intentos consecutivos de inicio de sesión fallidos.",
                    details=f"Cuenta bloqueada hasta {user.account_locked_until.isoformat()} UTC.",
                    timestamp=now,
                )

        recent_failures = (
            db.query(AuditLog)
            .filter(
                func.lower(AuditLog.email) == login_data.email.lower(),
                AuditLog.event == "Intento Fallido",
                AuditLog.status == "Fallido",
                AuditLog.timestamp >= now - timedelta(minutes=5),
            )
            .all()
        )
        is_brute_force = len(recent_failures) >= 3
        alert_reason = "Alerta de Fuerza Bruta" if is_brute_force else None
        if is_brute_force:
            for failed_attempt in recent_failures:
                failed_attempt.is_suspicious = True
                failed_attempt.alert_reason = alert_reason

        record_audit_event(
            db,
            request,
            user_id=user.id if user else None,
            email=login_data.email,
            event="Intento Fallido",
            status="Fallido",
            is_suspicious=is_brute_force,
            alert_reason=alert_reason,
            details="Credenciales incorrectas.",
            timestamp=now,
        )
        db.commit()
        if user and user.account_locked_until:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail="Cuenta bloqueada temporalmente. Intenta nuevamente en 15 minutos.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas. Verifique su email y contraseña.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        record_audit_event(
            db,
            request,
            user_id=user.id,
            email=user.email,
            event="Intento Fallido",
            status="Fallido",
            details="La cuenta está inactiva.",
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La cuenta se encuentra inactiva. Contacte al administrador.",
        )

    user.failed_login_attempts = 0
    user.account_locked_until = None
    if user.two_factor_enabled:
        challenge_id = str(uuid.uuid4())
        user.two_factor_challenge_id = challenge_id
        db.commit()
        preauth_token = jwt.encode(
            {
                "user_id": user.id,
                "challenge_id": challenge_id,
                "purpose": "mfa_preauth",
                "exp": datetime.now(timezone.utc) + MFA_PREAUTH_LIFETIME,
                "iss": "TurismoInteligenteColombia",
            },
            SECRET_KEY,
            algorithm=ALGORITHM,
        )
        response.delete_cookie(
            key="access_token",
            httponly=True,
            secure=should_use_secure_cookie(request),
            samesite="lax",
            path="/",
        )
        _set_cookie(
            response,
            request,
            "mfa_preauth",
            preauth_token,
            max_age=int(MFA_PREAUTH_LIFETIME.total_seconds()),
        )
        return {"status": "mfa_required"}

    return _complete_authenticated_login(user, request, response, db)


@router.post(
    "/2fa/setup",
    response_model=TwoFactorSetupResponse,
)
def setup_two_factor_authentication(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La autenticación en dos pasos ya está activada.",
        )

    secret = pyotp.random_base32()
    current_user.two_factor_secret = secret
    current_user.two_factor_challenge_id = None
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(
        name=current_user.email,
        issuer_name="TurismoInteligenteColombia",
    )
    qr_image = qrcode.make(provisioning_uri)
    image_buffer = io.BytesIO()
    qr_image.save(image_buffer, format="PNG")
    qr_base64 = base64.b64encode(image_buffer.getvalue()).decode("ascii")
    return {
        "qr_code_data_url": f"data:image/png;base64,{qr_base64}",
        "manual_entry_key": secret,
    }


@router.post("/2fa/verify-activate")
def verify_and_activate_two_factor_authentication(
    code_data: TwoFactorCode,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if not current_user.two_factor_secret:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Primero debes configurar la autenticación en dos pasos.",
        )
    if not pyotp.TOTP(current_user.two_factor_secret).verify(
        code_data.code,
        valid_window=1,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El código de verificación no es válido o ha expirado.",
        )

    current_user.two_factor_enabled = True
    current_user.two_factor_challenge_id = None
    db.commit()
    return {
        "message": "La autenticación en dos pasos quedó activada.",
        "two_factor_enabled": True,
    }


@router.post(
    "/2fa/authenticate",
    response_model=LoginResponse,
    response_model_exclude_none=True,
)
def authenticate_two_factor(
    code_data: TwoFactorCode,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    preauth_token = request.cookies.get("mfa_preauth")
    if not preauth_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La verificación de inicio de sesión expiró. Inicia sesión nuevamente.",
        )
    try:
        payload = jwt.decode(preauth_token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La verificación de inicio de sesión expiró. Inicia sesión nuevamente.",
        ) from error

    user_id = payload.get("user_id")
    challenge_id = payload.get("challenge_id")
    if payload.get("purpose") != "mfa_preauth" or not user_id or not challenge_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La sesión de verificación no es válida. Inicia sesión nuevamente.",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if (
        user is None
        or not user.is_active
        or not user.two_factor_enabled
        or not user.two_factor_secret
        or user.two_factor_challenge_id != challenge_id
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La sesión de verificación no es válida. Inicia sesión nuevamente.",
        )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if user.account_locked_until and user.account_locked_until > now:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Cuenta bloqueada temporalmente. Intenta nuevamente en 15 minutos.",
        )
    recent_mfa_failures = (
        db.query(AuditLog)
        .filter(
            AuditLog.user_id == user.id,
            AuditLog.event == "MFA_LOGIN_FAILED",
            AuditLog.status == "Fallido",
            AuditLog.timestamp >= now - timedelta(minutes=5),
        )
        .count()
    )
    if not pyotp.TOTP(user.two_factor_secret).verify(code_data.code, valid_window=1):
        record_audit_event(
            db,
            request,
            user_id=user.id,
            email=user.email,
            event="MFA_LOGIN_FAILED",
            status="Fallido",
            is_suspicious=True,
            alert_reason="Código de autenticación en dos pasos incorrecto.",
            details="La verificación TOTP del inicio de sesión fue rechazada.",
            timestamp=now,
        )
        if recent_mfa_failures + 1 >= LOGIN_MAX_ATTEMPTS:
            user.account_locked_until = now + LOCKOUT_DURATION
            user.two_factor_challenge_id = None
            record_audit_event(
                db,
                request,
                user_id=user.id,
                email=user.email,
                event="ACCOUNT_LOCKOUT",
                status="Fallido",
                is_suspicious=True,
                alert_reason="Cinco verificaciones TOTP fallidas en cinco minutos.",
                details=f"Cuenta bloqueada hasta {user.account_locked_until.isoformat()} UTC.",
                timestamp=now,
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail="Cuenta bloqueada temporalmente tras varios códigos incorrectos. Intenta nuevamente en 15 minutos.",
            )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El código de autenticación no es válido o ha expirado.",
        )

    result = _complete_authenticated_login(user, request, response, db)
    response.delete_cookie(
        key="mfa_preauth",
        httponly=True,
        secure=should_use_secure_cookie(request),
        samesite="lax",
        path="/",
    )
    return result


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> Response:
    token = request.cookies.get("access_token")
    if token:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except JWTError:
            payload = {}
        email = payload.get("sub")
        session_id = payload.get("session_id")
        if email and session_id:
            user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
            if user and user.current_session_token_id == session_id:
                user.current_session_token_id = None
                user.last_activity_at = None
                db.commit()
    response.delete_cookie(
        key="access_token",
        httponly=True,
        secure=should_use_secure_cookie(request),
        samesite="lax",
        path="/",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/forgot-password")
def forgot_password(
    request_data: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(func.lower(User.email) == request_data.email.lower()).first()
    if user:
        raw_token = secrets.token_urlsafe(32)
        now = datetime.utcnow()
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        ).update({PasswordResetToken.used_at: now}, synchronize_session=False)
        reset_token = PasswordResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
            expires_at=now + RESET_TOKEN_LIFETIME,
        )
        db.add(reset_token)
        db.commit()
        send_reset_password_email(user.email, raw_token)

    return {"message": "Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña."}


@router.post("/reset-password")
def reset_password(
    request_data: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    token_hash = hashlib.sha256(request_data.token.encode("utf-8")).hexdigest()
    now = datetime.utcnow()
    reset_token = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .first()
    )
    if not reset_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El enlace de restablecimiento no es válido o ha expirado.",
        )

    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El enlace de restablecimiento no es válido o ha expirado.",
        )

    requires_security_answer = user.role.casefold() in {
        "admin",
        "administrador",
        "superadmin",
    }
    if requires_security_answer:
        if not user.security_question or not user.security_answer_hash:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="La cuenta administrativa debe configurar una pregunta de seguridad antes de recuperar la contraseña.",
            )
        if not request_data.security_answer or not verify_password(
            request_data.security_answer,
            user.security_answer_hash,
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="La respuesta de seguridad es incorrecta.",
            )

    user.hashed_password = get_password_hash(request_data.password)
    user.failed_login_attempts = 0
    user.account_locked_until = None
    user.current_session_token_id = None
    user.last_activity_at = None
    reset_token.used_at = now
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.id != reset_token.id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)
    db.commit()
    return {"message": "Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión."}


@router.get("/reset-password/security-question")
def read_reset_security_question(
    token: str,
    db: Session = Depends(get_db),
):
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    reset_token = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > datetime.utcnow(),
        )
        .first()
    )
    if not reset_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El enlace de restablecimiento no es válido o ha expirado.",
        )

    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El enlace de restablecimiento no es válido o ha expirado.",
        )

    requires_security_answer = user.role.casefold() in {
        "admin",
        "administrador",
        "superadmin",
    }
    return {
        "requires_security_answer": requires_security_answer,
        "security_question": user.security_question if requires_security_answer else None,
    }


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)):
    """Obtiene el perfil y rol del usuario actualmente autenticado."""
    return current_user


# =========================================================================
# ENDPOINTS PROTEGIDOS EXCLUSIVOS PARA ADMINISTRADOR
# =========================================================================

@router.get(
    "/users",
    response_model=List[UserResponse],
)
def list_all_users(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_auditor),
):
    """Lista usuarios a Administradores y a Auditores autorizados."""
    users = db.query(User).all()
    if not user_has_permission(db, current_user, "manage_users"):
        record_auditor_read(db, request, current_user, "Administración")
    return users


@router.post(
    "/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_admin_user(
    user_in: AdminUserCreate,
    request: Request,
    db: Session = Depends(get_db),
    super_admin: User = Depends(require_super_admin),
):
    """Crea un usuario con rol asignado. Exclusivo para SuperAdmin."""
    if duplicate_email_exists(db, user_in.email):
        raise duplicate_email_error()

    role = db.query(Role).filter(Role.name == user_in.role).first()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El rol seleccionado no existe.",
        )
    if any(permission.name == "manage_roles" for permission in role.permissions):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede asignar un rol con control de administración de roles.",
        )

    if user_in.role == UserRole.AUDITOR.value and user_in.permisos is not None:
        permisos = json.dumps(user_in.permisos.model_dump())
    elif user_in.role == UserRole.AUDITOR.value:
        permisos = json.dumps({
            "ver_rbac": False,
            "ver_admin": False,
            "ver_comerciante": False,
        })
    else:
        if user_in.permisos is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Los permisos granulares solo pueden asignarse al rol Auditor.",
            )
        permisos = None

    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name,
        role=user_in.role,
        permisos=permisos,
        is_active=True,
    )
    db.add(user)
    record_audit_event(
        db,
        request,
        user_id=super_admin.id,
        email=super_admin.email,
        event="Creación de Usuario",
        status="Exitoso",
        details=f"SuperAdmin creó al usuario {user.email} con rol {user.role}.",
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if duplicate_email_exists(db, user_in.email):
            raise duplicate_email_error()
        raise

    db.refresh(user)
    return user


@router.patch("/users/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: int,
    role_update: UserUpdateRole,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_permission("manage_users")),
):
    """Permite al Administrador ascender o modificar el rol de un usuario."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario con ID {user_id} no encontrado.",
        )

    role = db.query(Role).filter(Role.name == role_update.role).first()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El rol seleccionado no existe.",
        )
    target_role_has_role_management = any(
        permission.name == "manage_roles" for permission in role.permissions
    )
    if target_role_has_role_management and not user_has_permission(db, admin_user, "manage_roles"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No puedes asignar un rol con control de administración de roles.",
        )
    if user_has_permission(db, user, "manage_roles") and not user_has_permission(
        db, admin_user, "manage_roles"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un usuario con control de administración de roles puede cambiar este rol.",
        )

    previous_role = user.role
    user.role = role_update.role
    record_audit_event(
        db,
        request,
        user_id=admin_user.id,
        email=admin_user.email,
        event="Cambio de Rol",
        status="Exitoso",
        details=f"Usuario {user.email}: {previous_role} → {user.role}",
    )
    db.commit()
    db.refresh(user)
    return user

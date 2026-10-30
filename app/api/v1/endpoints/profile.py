from datetime import datetime
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.deps import get_current_user, require_permission
from app.core.security import create_access_token, get_password_hash, verify_password
from app.db.models import User
from app.db.session import get_db
from app.schemas.auth import SecurityQuestionUpdate, UserProfileUpdate, UserResponse

router = APIRouter()
RESTRICTED_EMAIL_CHANGE_ROLES = {"superadmin", "administrador"}
ADMIN_EMAIL_CHANGE_ERROR = (
    "Por motivos de seguridad, los administradores no pueden modificar "
    "su dirección de correo electrónico"
)


def _set_refreshed_session_cookie(request: Request, response: Response, user: User) -> None:
    access_token = create_access_token(
        subject=user.email,
        role=user.role,
        user_id=user.id,
        full_name=user.full_name,
        session_id=user.current_session_token_id,
    )
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=(
            request.url.scheme == "https"
            or os.getenv("COOKIE_SECURE", "false").strip().lower() == "true"
            or os.getenv("APP_ENV", "development").strip().lower() == "production"
        ),
        samesite="lax",
        max_age=60 * 24 * 60 * 60,
        path="/",
    )


@router.put("/users/me/update", response_model=UserResponse)
def update_my_profile(
    profile_data: UserProfileUpdate,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    new_email = str(profile_data.email).strip()
    email_change_requested = new_email.casefold() != current_user.email.casefold()
    if (
        current_user.role.strip().casefold() in RESTRICTED_EMAIL_CHANGE_ROLES
        and email_change_requested
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ADMIN_EMAIL_CHANGE_ERROR,
        )

    if not verify_password(profile_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Contraseña actual incorrecta",
        )

    if not email_change_requested:
        new_email = current_user.email

    duplicate = (
        db.query(User.id)
        .filter(
            func.lower(User.email) == new_email.lower(),
            User.id != current_user.id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este correo electrónico ya está registrado",
        )

    previous_email = current_user.email
    current_user.email = new_email
    current_user.full_name = f"{profile_data.first_name} {profile_data.last_name}"
    current_user.last_activity_at = datetime.utcnow()
    record_audit_event(
        db,
        request,
        user_id=current_user.id,
        email=previous_email,
        event="USER_PROFILE_UPDATED",
        status="Exitoso",
        details=(
            f"El usuario {current_user.id} actualizó sus datos de perfil; "
            f"correo cambiado={'sí' if previous_email.casefold() != new_email.casefold() else 'no'}."
        ),
    )
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este correo electrónico ya está registrado",
        ) from error
    db.refresh(current_user)
    _set_refreshed_session_cookie(request, response, current_user)
    return current_user


@router.put("/users/me/security-question")
def update_security_question(
    security_data: SecurityQuestionUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("manage_security_questions")),
):
    if not verify_password(security_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Contraseña actual incorrecta",
        )

    current_user.security_question = security_data.question
    current_user.security_answer_hash = get_password_hash(security_data.answer)
    record_audit_event(
        db,
        request,
        user_id=current_user.id,
        email=current_user.email,
        event="SECURITY_QUESTION_UPDATED",
        status="Exitoso",
        details=f"El usuario administrativo {current_user.id} actualizó su pregunta de seguridad.",
    )
    db.commit()
    return {"message": "La pregunta de seguridad se guardó correctamente."}

"""
Esquemas Pydantic para Autenticación y Usuarios
Turismo Inteligente - Colombia
"""
from datetime import datetime
from enum import Enum
import json
import re
from typing import List, Literal, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator

MAX_PASSWORD_BYTES = 72
MAX_PASSWORD_LENGTH = 64
MIN_PASSWORD_LENGTH = 8
MAX_EMAIL_LENGTH = 100
EMAIL_PATTERN = re.compile(r"^(?!.*--)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
PASSWORD_REQUIREMENTS = re.compile(r"^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&]).+$")


def validate_email_address(email: str) -> str:
    if (
        not isinstance(email, str)
        or len(email) > MAX_EMAIL_LENGTH
        or not EMAIL_PATTERN.fullmatch(email)
    ):
        raise ValueError("Ingresa un correo válido de hasta 100 caracteres, sin espacios ni guiones dobles.")
    return email


def validate_password_length(password: str) -> str:
    try:
        password_bytes = password.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError("La contraseña debe ser texto UTF-8 válido.") from error
    if len(password_bytes) > MAX_PASSWORD_BYTES:
        raise ValueError(f"La contraseña no puede exceder {MAX_PASSWORD_BYTES} bytes en UTF-8.")
    return password


def validate_registration_password(password: str) -> str:
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        raise ValueError("La contraseña debe tener entre 8 y 64 caracteres.")
    validate_password_length(password)
    if not PASSWORD_REQUIREMENTS.fullmatch(password):
        raise ValueError(
            "La contraseña debe incluir mayúscula, minúscula, número y un carácter especial (@$!%*?&)."
        )
    return password


class UserRoleEnum(str, Enum):
    SUPER_ADMIN = "SuperAdmin"
    ADMIN = "Administrador"
    AUDITOR = "Auditor"
    MERCHANT = "Comerciante"
    TOURIST = "Turista"


class AuditorPermissions(BaseModel):
    ver_rbac: bool = False
    ver_admin: bool = False
    ver_comerciante: bool = False


class UserBase(BaseModel):
    email: EmailStr = Field(..., max_length=MAX_EMAIL_LENGTH)
    full_name: str = Field(..., min_length=2, max_length=100)

    @field_validator("email", mode="before")
    @classmethod
    def validate_email(cls, email: str) -> str:
        return validate_email_address(email)


class UserCreate(UserBase):
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    # Por defecto todo nuevo registro es Turista a menos que se especifique lo contrario
    role: Optional[UserRoleEnum] = UserRoleEnum.TOURIST

    @field_validator("password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return validate_registration_password(password)


class AdminUserCreate(UserBase):
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    role: str = Field(..., min_length=2, max_length=50)
    permisos: Optional[AuditorPermissions] = None

    @field_validator("password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return validate_registration_password(password)


class UserLogin(BaseModel):
    email: EmailStr = Field(..., max_length=MAX_EMAIL_LENGTH)
    password: str = Field(..., max_length=MAX_PASSWORD_BYTES)

    @field_validator("email", mode="before")
    @classmethod
    def validate_email(cls, email: str) -> str:
        return validate_email_address(email)

    @field_validator("password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return validate_password_length(password)


class UserUpdateRole(BaseModel):
    role: str = Field(..., min_length=2, max_length=50)


class UserResponse(UserBase):
    id: int
    role: str
    is_active: bool
    two_factor_enabled: bool = False
    created_at: datetime
    permisos: Optional[AuditorPermissions] = None
    permissions: List[str] = Field(default_factory=list, validation_alias="effective_permissions")

    @field_validator("permisos", mode="before")
    @classmethod
    def parse_permissions(cls, permissions: object) -> object:
        if permissions is None or isinstance(permissions, AuditorPermissions):
            return permissions
        if isinstance(permissions, str):
            try:
                return json.loads(permissions)
            except json.JSONDecodeError as error:
                raise ValueError("Los permisos almacenados para el usuario no son válidos.") from error
        return permissions

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: int
    full_name: str


class LoginResponse(BaseModel):
    status: Literal["authenticated", "mfa_required"] = "authenticated"
    token_type: Optional[str] = None
    role: Optional[str] = None
    user_id: Optional[int] = None
    full_name: Optional[str] = None


class TwoFactorCode(BaseModel):
    code: str = Field(..., pattern=r"^\d{6}$")


class TwoFactorSetupResponse(BaseModel):
    qr_code_data_url: str
    manual_entry_key: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr = Field(..., max_length=MAX_EMAIL_LENGTH)

    @field_validator("email", mode="before")
    @classmethod
    def validate_email(cls, email: str) -> str:
        return validate_email_address(email)


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=32, max_length=128)
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    security_answer: Optional[str] = Field(default=None, min_length=2, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return validate_registration_password(password)

    @field_validator("security_answer")
    @classmethod
    def validate_security_answer(cls, answer: Optional[str]) -> Optional[str]:
        if answer is None:
            return None
        normalized = answer.strip()
        if len(normalized.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError("La respuesta de seguridad excede el límite permitido.")
        return normalized


class UserProfileUpdate(BaseModel):
    email: EmailStr = Field(..., max_length=MAX_EMAIL_LENGTH)
    first_name: str = Field(..., min_length=1, max_length=60)
    last_name: str = Field(..., min_length=1, max_length=60)
    current_password: str = Field(..., min_length=1, max_length=MAX_PASSWORD_BYTES)

    @field_validator("email", mode="before")
    @classmethod
    def validate_email(cls, email: str) -> str:
        return validate_email_address(email)

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_person_name(cls, name: str) -> str:
        normalized = name.strip()
        if not re.fullmatch(r"[^\W\d_]+(?:[ '-][^\W\d_]+)*", normalized, flags=re.UNICODE):
            raise ValueError("El nombre solo puede incluir letras, espacios, apóstrofos y guiones.")
        return normalized


class SecurityQuestionUpdate(BaseModel):
    question: str = Field(..., min_length=8, max_length=255)
    answer: str = Field(..., min_length=2, max_length=128)
    current_password: str = Field(..., min_length=1, max_length=MAX_PASSWORD_BYTES)

    @field_validator("question")
    @classmethod
    def validate_question(cls, question: str) -> str:
        normalized = question.strip()
        if not normalized:
            raise ValueError("La pregunta de seguridad no puede estar vacía.")
        return normalized

    @field_validator("answer")
    @classmethod
    def validate_answer(cls, answer: str) -> str:
        normalized = answer.strip()
        if len(normalized.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError("La respuesta de seguridad excede el límite permitido.")
        return normalized

    @field_validator("current_password")
    @classmethod
    def validate_current_password(cls, password: str) -> str:
        return validate_password_length(password)

class TokenData(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None


class RoleCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=50, pattern=r"^[A-Za-z0-9 _-]+$")
    description: str = Field(default="", max_length=255)
    permission_ids: List[int] = Field(default_factory=list, max_length=100)


class RoleResponse(BaseModel):
    id: int
    name: str
    description: str
    permission_ids: List[int]
    permissions: List[str]


class UserPermissionsUpdate(BaseModel):
    permission_ids: List[int] = Field(max_length=100)


class AdminPasswordResetRequest(BaseModel):
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)

    @field_validator("password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        return validate_registration_password(password)

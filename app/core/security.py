"""
Módulo de Criptografía y Generación de Tokens JWT
Turismo Inteligente - Colombia
"""
from datetime import datetime, timedelta
from typing import Any, Optional, Union
from jose import jwt
from passlib.context import CryptContext

# Configuración de cifrado
SECRET_KEY = "TURISMO_COLOMBIA_SECRET_KEY_SUPER_SECURE_2026_PROD"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 horas

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
MAX_BCRYPT_PASSWORD_BYTES = 72


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica si la contraseña plana coincide con el hash almacenado."""
    if len(plain_password.encode("utf-8")) > MAX_BCRYPT_PASSWORD_BYTES:
        return False
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Genera el hash seguro utilizando bcrypt."""
    if len(password.encode("utf-8")) > MAX_BCRYPT_PASSWORD_BYTES:
        raise ValueError(
            f"La contraseña no puede exceder {MAX_BCRYPT_PASSWORD_BYTES} bytes en UTF-8."
        )
    return pwd_context.hash(password)


def create_access_token(
    subject: Union[str, Any],
    role: str,
    user_id: int,
    full_name: Optional[str] = None,
    expires_delta: Optional[timedelta] = None,
    session_id: Optional[str] = None,
) -> str:
    """Crea un token JWT firmado conteniendo el ID, email, rol y expiración."""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "user_id": user_id,
        "role": role,
        "full_name": full_name or "",
        "iss": "TurismoInteligenteColombia",
    }
    if session_id is not None:
        to_encode["session_id"] = session_id
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

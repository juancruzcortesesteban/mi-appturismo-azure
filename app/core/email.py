from urllib.parse import urlencode

from app.core.config import settings


def build_reset_password_url(token: str) -> str:
    return (
        f"{settings.FRONTEND_HOST}/reset-password?"
        f"{urlencode({'token': token})}"
    )


def send_reset_password_email(email: str, token: str) -> str | None:
    reset_url = build_reset_password_url(token)
    if settings.DEBUG or settings.ENV == "development":
        print(
            "\n"
            "=========================================\n"
            "[DEV EMAIL INTERCEPTOR]\n"
            f"Para: {email}\n"
            "Asunto: Recuperación de contraseña - Turismo Inteligente Colombia\n"
            f"Enlace de recuperación real: {reset_url}\n"
            "=========================================",
            flush=True,
        )
        return reset_url

    print(
        f"No se envió el correo de recuperación: falta configurar un proveedor "
        f"de correo para el entorno {settings.ENV}.",
        flush=True,
    )
    return None

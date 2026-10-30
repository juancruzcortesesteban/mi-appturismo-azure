import os


class Settings:
    def __init__(self) -> None:
        self.ENV = os.getenv("ENV", os.getenv("APP_ENV", "development")).strip().lower()
        debug_value = os.getenv("DEBUG")
        self.DEBUG = (
            debug_value.strip().lower() in {"1", "true", "yes", "on"}
            if debug_value is not None
            else self.ENV == "development"
        )
        self.FRONTEND_HOST = os.getenv(
            "FRONTEND_HOST",
            os.getenv("FRONTEND_BASE_URL", "http://localhost:3000"),
        ).rstrip("/")


settings = Settings()

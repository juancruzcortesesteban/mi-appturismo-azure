"""
Sesión de Base de Datos y Engine SQLAlchemy
Turismo Inteligente - Colombia
"""
import json

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

# Base de datos SQLite local para pruebas rápidas o PostgreSQL configurable
SQLALCHEMY_DATABASE_URL = "sqlite:///./turismo_colombia.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in SQLALCHEMY_DATABASE_URL else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PERMISSION_SEEDS = {
    "access_admin": "Consultar la consola de administración",
    "access_rbac": "Consultar archivos y herramientas RBAC",
    "access_merchant": "Acceder al portal de comerciantes",
    "write_operations": "Crear y modificar operaciones autorizadas",
    "read_only": "Consultar contenido sin modificarlo",
    "manage_roles": "Crear roles y administrar permisos",
    "manage_users": "Administrar usuarios y sus permisos",
    "read_audit": "Consultar registros de auditoría",
    "manage_security_questions": "Configurar preguntas de seguridad propias",
}

ROLE_PERMISSION_SEEDS = {
    "SuperAdmin": set(PERMISSION_SEEDS),
    "Administrador": {
        "access_admin",
        "access_merchant",
        "write_operations",
        "read_audit",
        "read_only",
        "manage_security_questions",
    },
    "Auditor": {"read_only"},
    "Comerciante": {"access_merchant", "write_operations", "read_only"},
    "Turista": {"read_only"},
}

ROLE_DESCRIPTIONS = {
    "SuperAdmin": "Control total del sistema",
    "Administrador": "Administración y operaciones del sistema",
    "Auditor": "Consulta de módulos autorizados",
    "Comerciante": "Gestión del portal y contenido propio",
    "Turista": "Consulta de contenido turístico",
}


def ensure_user_permissions_column(database_engine=engine) -> None:
    inspector = inspect(database_engine)
    columns = {column["name"] for column in inspector.get_columns("users")}
    migrations = {
        "permisos": "TEXT",
        "failed_login_attempts": "INTEGER NOT NULL DEFAULT 0",
        "account_locked_until": "DATETIME",
        "current_session_token_id": "VARCHAR(36)",
        "last_activity_at": "DATETIME",
        "security_question": "VARCHAR(255)",
        "security_answer_hash": "VARCHAR(255)",
        "two_factor_enabled": "BOOLEAN NOT NULL DEFAULT 0",
        "two_factor_secret": "VARCHAR(64)",
        "two_factor_challenge_id": "VARCHAR(36)",
    }
    missing_columns = {
        name: definition for name, definition in migrations.items() if name not in columns
    }
    if missing_columns:
        with database_engine.begin() as connection:
            for name, definition in missing_columns.items():
                connection.exec_driver_sql(
                    f"ALTER TABLE users ADD COLUMN {name} {definition}"
                )

    def seed_rbac(connection) -> None:
        existing_roles = connection.exec_driver_sql(
            "SELECT DISTINCT role FROM users WHERE role IS NOT NULL"
        ).scalars().all()
        role_names_by_key = {
            role_name.casefold(): role_name for role_name in ROLE_PERMISSION_SEEDS
        }
        for existing_role in existing_roles:
            role_name = str(existing_role)
            role_names_by_key.setdefault(role_name.casefold(), role_name)
        role_names = set(role_names_by_key.values())

        for role_name in role_names:
            connection.exec_driver_sql(
                "INSERT INTO roles (name, description) VALUES (?, ?) "
                "ON CONFLICT(name) DO NOTHING",
                (role_name, ROLE_DESCRIPTIONS.get(role_name, "Rol personalizado migrado")),
            )
        for permission_name, description in PERMISSION_SEEDS.items():
            connection.exec_driver_sql(
                "INSERT INTO permissions (name, description) VALUES (?, ?) "
                "ON CONFLICT(name) DO NOTHING",
                (permission_name, description),
            )

        permission_ids = dict(connection.exec_driver_sql(
            "SELECT name, id FROM permissions"
        ).all())
        role_ids = {
            name.casefold(): role_id
            for name, role_id in connection.exec_driver_sql("SELECT name, id FROM roles").all()
        }
        for role_name, permission_names in ROLE_PERMISSION_SEEDS.items():
            for permission_name in permission_names:
                connection.exec_driver_sql(
                    "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
                    (role_ids[role_name.casefold()], permission_ids[permission_name]),
                )
        seeded_role_keys = {role_name.casefold() for role_name in ROLE_PERMISSION_SEEDS}
        for role_name in role_names:
            if role_name.casefold() in seeded_role_keys:
                continue
            connection.exec_driver_sql(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
                (role_ids[role_name.casefold()], permission_ids["read_only"]),
            )

        users_with_legacy_permissions = connection.exec_driver_sql(
            "SELECT id, permisos FROM users WHERE permisos IS NOT NULL"
        ).all()
        legacy_permission_map = {
            "ver_admin": "access_admin",
            "ver_rbac": "access_rbac",
            "ver_comerciante": "access_merchant",
        }
        for user_id, serialized in users_with_legacy_permissions:
            try:
                legacy_permissions = json.loads(serialized)
            except (TypeError, json.JSONDecodeError):
                continue
            if not isinstance(legacy_permissions, dict):
                continue
            for legacy_name, permission_name in legacy_permission_map.items():
                if legacy_permissions.get(legacy_name) is True:
                    connection.exec_driver_sql(
                        "INSERT OR REPLACE INTO user_permissions "
                        "(user_id, permission_id, granted) VALUES (?, ?, 1)",
                        (user_id, permission_ids[permission_name]),
                    )

    with database_engine.begin() as connection:
        seed_rbac(connection)

    user_foreign_keys = inspect(database_engine).get_foreign_keys("users")
    role_is_foreign_key = any(
        foreign_key.get("constrained_columns") == ["role"]
        and foreign_key.get("referred_table") == "roles"
        for foreign_key in user_foreign_keys
    )
    if not role_is_foreign_key:
        with database_engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
            with connection.begin():
                connection.exec_driver_sql(
                    """
                    CREATE TABLE users_rbac_new (
                        id INTEGER NOT NULL PRIMARY KEY,
                        email VARCHAR(255) NOT NULL,
                        hashed_password VARCHAR(255) NOT NULL,
                        full_name VARCHAR(255) NOT NULL,
                        role VARCHAR(50) COLLATE NOCASE NOT NULL REFERENCES roles(name),
                        permisos TEXT,
                        is_active BOOLEAN,
                        created_at DATETIME,
                        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
                        account_locked_until DATETIME,
                        current_session_token_id VARCHAR(36),
                        last_activity_at DATETIME,
                        security_question VARCHAR(255),
                        security_answer_hash VARCHAR(255),
                        two_factor_enabled BOOLEAN NOT NULL DEFAULT 0,
                        two_factor_secret VARCHAR(64),
                        two_factor_challenge_id VARCHAR(36)
                    )
                    """
                )
                connection.exec_driver_sql(
                    """
                    INSERT INTO users_rbac_new (
                        id, email, hashed_password, full_name, role, permisos, is_active,
                        created_at, failed_login_attempts, account_locked_until,
                        current_session_token_id, last_activity_at,
                        security_question, security_answer_hash,
                        two_factor_enabled, two_factor_secret, two_factor_challenge_id
                    )
                    SELECT
                        id, email, hashed_password, full_name, role, permisos, is_active,
                        created_at, failed_login_attempts, account_locked_until,
                        current_session_token_id, last_activity_at,
                        security_question, security_answer_hash,
                        two_factor_enabled, two_factor_secret, two_factor_challenge_id
                    FROM users
                    """
                )
                connection.exec_driver_sql("DROP TABLE users")
                connection.exec_driver_sql("ALTER TABLE users_rbac_new RENAME TO users")
                connection.exec_driver_sql(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email)"
                )
                connection.exec_driver_sql(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_nocase "
                    "ON users(email COLLATE NOCASE)"
                )
                connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_users_id ON users(id)")
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")

    with database_engine.begin() as connection:
        duplicate = connection.exec_driver_sql(
            "SELECT lower(email) FROM users GROUP BY lower(email) HAVING COUNT(*) > 1 LIMIT 1"
        ).first()
        if duplicate:
            raise RuntimeError(
                "La base de datos contiene correos duplicados sin distinguir mayúsculas; "
                "resuélvelos antes de iniciar la API."
            )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_nocase "
            "ON users(email COLLATE NOCASE)"
        )


def get_db():
    """Generador de sesión de base de datos para inyección de dependencias FastAPI."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

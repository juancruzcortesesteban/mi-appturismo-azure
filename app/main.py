"""
Punto de Entrada Principal - FastAPI Backend
Turismo Inteligente - Colombia
"""
from pathlib import Path
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.endpoints import admin, auth, chat, favorites, places, profile, routes, system
from app.core.security import get_password_hash
from app.core.seed import ensure_super_admin
from app.db.models import Base, Place, User
from app.db.session import SessionLocal, engine, ensure_user_permissions_column

# Inicialización de tablas en la base de datos
Base.metadata.create_all(bind=engine)
ensure_user_permissions_column(engine)

app = FastAPI(
    title="Turismo Inteligente - Colombia API",
    description="Backend oficial con Control de Acceso Basado en Roles (RBAC) estricto y cálculo de rutas turísticas.",
    version="2.0.0",
)

UPLOADS_DIRECTORY = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIRECTORY.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIRECTORY), name="uploads")

# Configuración de CORS
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclusión de Routers de la API v1
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Autenticación y Usuarios (RBAC)"])
app.include_router(profile.router, prefix="/api/v1", tags=["Perfil de Usuario"])
app.include_router(places.router, prefix="/api/v1/places", tags=["Lugares Turísticos"])
app.include_router(favorites.router, prefix="/api/v1/favorites", tags=["Favoritos (Turista)"])
app.include_router(routes.router, prefix="/api/v1/routes", tags=["Rutas Inteligentes"])
app.include_router(chat.router, prefix="/api/v1/chat", tags=["Guía Turístico Gemini"])
app.include_router(chat.router, prefix="/api/chat", tags=["Guía Turístico Gemini"])
app.include_router(system.router, prefix="/api/v1/system", tags=["Sistema (SuperAdmin)"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["Monitoreo de Seguridad"])


@app.on_event("startup")
def seed_initial_data():
    """Siembra inicial de usuarios con roles y lugares emblemáticos de Colombia."""
    db = SessionLocal()
    try:
        # Verificar si existen usuarios
        if db.query(User).count() == 0:
            admin_user = User(
                email="admin@turismocolombia.co",
                full_name="Carlos Administrador Gómez",
                hashed_password=get_password_hash("Admin1234!"),
                role="Administrador",
                is_active=True,
            )
            merchant_user = User(
                email="comerciante@andesaventura.co",
                full_name="Valentina Morales Guía",
                hashed_password=get_password_hash("Merchant1234!"),
                role="Comerciante",
                is_active=True,
            )
            tourist_user = User(
                email="turista@viajero.com",
                full_name="Mateo Silva Viajero",
                hashed_password=get_password_hash("Turista1234!"),
                role="Turista",
                is_active=True,
            )
            db.add_all([admin_user, merchant_user, tourist_user])
            db.commit()
            db.refresh(merchant_user)
            db.refresh(admin_user)

            # Sembrar lugares representativos de Colombia
            seed_places = [
                Place(
                    name="Parque Nacional Natural El Cocuy",
                    description="Espectacular sierra nevada en los Andes orientales con picos glaciares como el Pan de Azúcar, lagunas de origen glaciar y senderos de alta montaña para montañismo responsable.",
                    category="Aventura",
                    department="Boyacá",
                    city="El Cocuy",
                    latitude=6.4678,
                    longitude=-72.3167,
                    entry_fee=38000.0,
                    rating=4.9,
                    is_verified=True,
                    merchant_id=merchant_user.id,
                    image_url="https://images.unsplash.com/photo-1544620347-c4fd4a3d5957",
                ),
                Place(
                    name="Parque Nacional Natural Los Nevados",
                    description="Páramos volcánicos andinos coronados por el volcán Nevado del Ruiz y del Tolima. Hábitat del cóndor andino y bosques de frailejones milenarios.",
                    category="Aventura",
                    department="Caldas / Tolima",
                    city="Manizales",
                    latitude=4.8922,
                    longitude=-75.3194,
                    entry_fee=34000.0,
                    rating=4.8,
                    is_verified=True,
                    merchant_id=merchant_user.id,
                    image_url="https://images.unsplash.com/photo-1506744038136-46273834b3fb",
                ),
                Place(
                    name="Ciudad Amurallada e Historia de Cartagena",
                    description="Patrimonio histórico de la humanidad con fortificaciones coloniales, balcones con buganvilias, plazas coloniales y el emblemático Castillo San Felipe de Barajas.",
                    category="Histórico",
                    department="Bolívar",
                    city="Cartagena de Indias",
                    latitude=10.4236,
                    longitude=-75.5528,
                    entry_fee=25000.0,
                    rating=4.9,
                    is_verified=True,
                    merchant_id=merchant_user.id,
                    image_url="https://images.unsplash.com/photo-1583531352515-8884af319dc1",
                ),
                Place(
                    name="Pueblo de Guatapé y Piedra del Peñol",
                    description="Famoso por sus zócalos pintorescos tallados a mano en cada fachada y la impresionante mole monolítica de 220 metros con vista panorámica 360 grados sobre el embalse.",
                    category="Cultural",
                    department="Antioquia",
                    city="Guatapé",
                    latitude=6.2328,
                    longitude=-75.1565,
                    entry_fee=20000.0,
                    rating=4.7,
                    is_verified=True,
                    merchant_id=merchant_user.id,
                    image_url="https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
                ),
                Place(
                    name="Santuario de Las Lajas",
                    description="Obra maestra de la arquitectura neogótica erigida en el cañón del río Guáitara. Una joya arquitectónica e histórica reconocida a nivel mundial.",
                    category="Histórico",
                    department="Nariño",
                    city="Ipiales",
                    latitude=0.8053,
                    longitude=-77.5861,
                    entry_fee=0.0,
                    rating=4.9,
                    is_verified=True,
                    merchant_id=admin_user.id,
                    image_url="https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7",
                ),
            ]
            db.add_all(seed_places)
            db.commit()

        ensure_super_admin(db)
    finally:
        db.close()


@app.get("/api/v1/health")
def health_check():
    """Endpoint de comprobación de salud del servicio."""
    return {"status": "ok", "service": "Turismo Inteligente - Colombia API", "version": "2.0.0"}


STATIC_DIRECTORY = Path(__file__).resolve().parent / "static"
if STATIC_DIRECTORY.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIRECTORY, html=True), name="frontend")

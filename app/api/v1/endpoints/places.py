"""
Endpoints de Gestión de Lugares Turísticos con RBAC Estricto
Turismo Inteligente - Colombia
"""
import secrets
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.orm import Session, joinedload

from app.core.deps import (
    get_current_active_user_optional,
    get_current_user,
    require_admin,
    require_merchant_portal_read,
    require_merchant_or_admin,
    user_has_permission,
)
from app.core.audit import record_auditor_read
from app.db.models import Place, User
from app.db.session import get_db
from app.schemas.places import PlaceCreate, PlaceResponse, PlaceUpdate

router = APIRouter()
PLACE_IMAGE_DIRECTORY = Path(__file__).resolve().parents[3] / "uploads" / "places"
MAX_PLACE_IMAGE_BYTES = 5 * 1024 * 1024
PLACE_IMAGE_TYPES = {
    "image/jpeg": (".jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/png": (".png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": (".webp", lambda data: data.startswith(b"RIFF") and data[8:12] == b"WEBP"),
}
DEFAULT_PLACE_IMAGES = (
    "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
)


@router.get("", response_model=List[PlaceResponse])
def get_places(
    category: Optional[str] = Query(None, description="Filtrar por categoría (Aventura, Cultural, Histórico)"),
    department: Optional[str] = Query(None, description="Filtrar por departamento"),
    search: Optional[str] = Query(None, description="Búsqueda por texto en nombre o descripción"),
    verified_only: bool = Query(False, description="Mostrar solo lugares verificados"),
    current_user: Optional[User] = Depends(get_current_active_user_optional),
    db: Session = Depends(get_db),
):
    """
    Consulta pública y abierta para 'Turista', 'Comerciante' y 'Administrador'.
    Permite buscar, filtrar y explorar la oferta turística de Colombia.
    """
    query = db.query(Place).options(joinedload(Place.merchant))

    if category and category != "Todos":
        query = query.filter(Place.category.ilike(f"%{category}%"))

    if department:
        query = query.filter(Place.department.ilike(f"%{department}%"))

    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            (Place.name.ilike(search_filter)) | (Place.description.ilike(search_filter))
        )

    if verified_only:
        query = query.filter(Place.is_verified.is_(True))

    return query.all()


@router.get("/my-places", response_model=List[PlaceResponse])
def get_my_merchant_places(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_merchant_portal_read),
):
    """
    Exclusivo para 'Comerciante' y 'Administrador'.
    El comerciante ÚNICAMENTE puede visualizar los lugares que le pertenecen (su propio catálogo).
    Si un Administrador lo consulta, puede ver todos o los propios.
    """
    if not user_has_permission(db, current_user, "access_admin"):
        places = (
            db.query(Place)
            .options(joinedload(Place.merchant))
            .filter(Place.merchant_id == current_user.id)
            .all()
        )
    else:
        # Administradores y auditores pueden consultar todos los lugares; solo los primeros modifican.
        places = db.query(Place).options(joinedload(Place.merchant)).all()
    if not user_has_permission(db, current_user, "write_operations"):
        record_auditor_read(db, request, current_user, "Portal Comerciante")
    return places


@router.get("/{place_id}", response_model=PlaceResponse)
def get_place_detail(place_id: int, db: Session = Depends(get_db)):
    """Obtiene el detalle completo de un lugar turístico específico."""
    place = db.query(Place).filter(Place.id == place_id).first()
    if not place:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lugar turístico con ID {place_id} no fue encontrado.",
        )
    return place


@router.post("", response_model=PlaceResponse, status_code=status.HTTP_201_CREATED)
def create_place(
    place_in: PlaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_merchant_or_admin),
):
    """
    Creación de lugar turístico.
    PERMISOS:
    - 'Turista': ACCESO DENEGADO (HTTP 403 Forbidden).
    - 'Comerciante' o 'Administrador': El lugar queda pendiente de verificación.
    - El propietario se asigna automáticamente desde el usuario autenticado.
    """
    # Verificación estricta: un turista nunca pasa la dependencia require_merchant_or_admin
    new_place = Place(
        name=place_in.name,
        description=place_in.description,
        category=place_in.category,
        department=place_in.department,
        city=place_in.city,
        latitude=place_in.latitude,
        longitude=place_in.longitude,
        entry_fee=place_in.entry_fee,
        image_url=place_in.image_url or secrets.choice(DEFAULT_PLACE_IMAGES),
        is_verified=False,
        merchant_id=current_user.id,
    )
    db.add(new_place)
    db.commit()
    return (
        db.query(Place)
        .options(joinedload(Place.merchant))
        .filter(Place.id == new_place.id)
        .one()
    )


@router.post("/images", status_code=status.HTTP_201_CREATED)
async def upload_place_image(
    image: UploadFile = File(...),
    current_user: User = Depends(require_merchant_or_admin),
):
    """Guarda una imagen de lugar con nombre generado por el servidor."""
    image_type = PLACE_IMAGE_TYPES.get(image.content_type or "")
    if image_type is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Formato no admitido. Sube una imagen JPEG, PNG o WebP.",
        )

    contents = await image.read(MAX_PLACE_IMAGE_BYTES + 1)
    await image.close()
    if len(contents) > MAX_PLACE_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La imagen no puede superar 5 MB.",
        )

    extension, signature_check = image_type
    if not signature_check(contents):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El contenido del archivo no coincide con el formato de imagen declarado.",
        )

    PLACE_IMAGE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    filename = f"{secrets.token_hex(16)}{extension}"
    (PLACE_IMAGE_DIRECTORY / filename).write_bytes(contents)
    return {"image_url": f"/uploads/places/{filename}"}


@router.put("/{place_id}", response_model=PlaceResponse)
def update_place(
    place_id: int,
    place_in: PlaceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_merchant_or_admin),
):
    """
    Edición de lugar turístico.
    PERMISOS:
    - 'Turista': ACCESO DENEGADO (HTTP 403 Forbidden).
    - 'Comerciante': SOLO puede editar sus propios lugares creados (merchant_id == user.id).
      No puede modificar configuraciones globales ni el flag `is_verified`.
    - 'Administrador': Puede editar cualquier lugar del sistema y validar estado de verificación.
    """
    place = db.query(Place).filter(Place.id == place_id).first()
    if not place:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lugar turístico con ID {place_id} no existe.",
        )

    # Validar propiedad para Comerciante
    if (
        not user_has_permission(db, current_user, "access_admin")
        and place.merchant_id != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operación no autorizada: Como comerciante únicamente puedes editar tus propios atractivos turísticos.",
        )

    update_data = place_in.dict(exclude_unset=True)

    # Solo el Administrador puede cambiar el estado de verificación
    if "is_verified" in update_data and not user_has_permission(db, current_user, "access_admin"):
        del update_data["is_verified"]

    for field, value in update_data.items():
        setattr(place, field, value)

    db.commit()
    db.refresh(place)
    return place


@router.patch("/{place_id}/status", response_model=PlaceResponse)
def update_place_verification_status(
    place_id: int,
    place_in: PlaceUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    """Permite al Administrador aprobar o revocar la verificación de un lugar."""
    if place_in.is_verified is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Debe especificar el estado is_verified.",
        )

    place = (
        db.query(Place)
        .options(joinedload(Place.merchant))
        .filter(Place.id == place_id)
        .first()
    )
    if not place:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lugar turístico con ID {place_id} no existe.",
        )

    place.is_verified = place_in.is_verified
    db.commit()
    db.refresh(place)
    return place


@router.delete("/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place(
    place_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_merchant_or_admin),
):
    """
    Eliminación de lugares turísticos.
    PERMISOS:
    - 'Turista': ACCESO DENEGADO.
    - 'Comerciante': Solo puede eliminar sus propios lugares.
    - 'Administrador': Control total para eliminar cualquier lugar reportado o inapropiado.
    """
    place = db.query(Place).filter(Place.id == place_id).first()
    if not place:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lugar con ID {place_id} no existe.",
        )

    if (
        not user_has_permission(db, current_user, "access_admin")
        and place.merchant_id != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operación denegada: No tienes permiso para eliminar atractivos de otros comerciantes.",
        )

    db.delete(place)
    db.commit()
    return None

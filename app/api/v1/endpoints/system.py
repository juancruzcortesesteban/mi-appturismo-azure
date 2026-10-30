"""Endpoints de lectura del sistema para SuperAdmin y Auditor."""
from pathlib import Path
from typing import Dict, List, Union

from fastapi import APIRouter, Depends, Request

from app.core.audit import record_auditor_read
from app.core.deps import require_super_admin_or_auditor, user_has_permission
from app.db.models import User
from app.db.session import get_db
from sqlalchemy.orm import Session

router = APIRouter()

PROJECT_ROOT = Path(__file__).resolve().parents[4]
EXCLUDED_NAMES = {
    ".git",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "uploads",
}
EXCLUDED_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pyc"}
MAX_TREE_DEPTH = 4

TreeNode = Dict[str, Union[str, List["TreeNode"]]]


def build_source_tree(directory: Path, depth: int = 0) -> List[TreeNode]:
    """Return a bounded directory/file-name tree without reading file contents."""
    if depth >= MAX_TREE_DEPTH:
        return []

    nodes: List[TreeNode] = []
    for path in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        if path.is_symlink():
            continue
        if path.name.startswith(".") or path.name in EXCLUDED_NAMES:
            continue
        if path.is_file() and path.suffix.lower() in EXCLUDED_SUFFIXES:
            continue

        if path.is_dir():
            nodes.append({
                "name": path.name,
                "type": "directory",
                "children": build_source_tree(path, depth + 1),
            })
        else:
            nodes.append({"name": path.name, "type": "file"})

    return nodes


@router.get("/source-code")
def read_source_tree(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin_or_auditor),
):
    """Return a filtered project directory tree; source file contents are never exposed."""
    response = {
        "root": PROJECT_ROOT.name,
        "tree": build_source_tree(PROJECT_ROOT),
    }
    if not user_has_permission(db, current_user, "manage_roles"):
        record_auditor_read(db, request, current_user, "Archivos RBAC")
    return response

/**
 * Lógica pura de Control de Acceso Basado en Roles (RBAC)
 * Turismo Inteligente - Colombia
 */

export type UserRole = string;

export interface AuditorPermissions {
  ver_rbac: boolean;
  ver_admin: boolean;
  ver_comerciante: boolean;
}

export interface UserSession {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  twoFactorEnabled?: boolean;
  permisos?: AuditorPermissions | null;
  permissions?: string[];
}

export interface PlaceEntity {
  id: number;
  name: string;
  merchantId: number;
  category: string;
}

export const ROLE_LEVELS: Partial<Record<UserRole, number>> = {
  SuperAdmin: 4,
  Administrador: 3,
  Auditor: 2,
  Comerciante: 2,
  Turista: 1,
};

/**
 * Evalúa si un usuario tiene permiso para acceder a una ruta protegida.
 */
export function canAccessView(
  _role: UserRole,
  targetView: 'index' | 'places' | 'merchant' | 'admin' | 'code',
  _legacyPermissions?: AuditorPermissions | null,
  permissionNames: string[] = [],
): {
  allowed: boolean;
  reason?: string;
} {
  if (targetView === 'index' || targetView === 'places') {
    return { allowed: true };
  }

  if (targetView === 'code') {
    return { allowed: permissionNames.includes('access_rbac') };
  }

  if (targetView === 'merchant') {
    return {
      allowed: permissionNames.includes('access_merchant'),
      reason: 'Tu rol no tiene el permiso para acceder al portal de Comerciantes.',
    };
  }

  if (targetView === 'admin') {
    return {
      allowed: permissionNames.includes('access_admin'),
      reason: 'Tu rol no tiene el permiso para acceder a la administración.',
    };
  }

  return { allowed: true };
}

/**
 * Evalúa si un usuario puede editar o eliminar un lugar turístico específico.
 */
export function canManagePlace(user: UserSession, place: PlaceEntity): {
  canEdit: boolean;
  canDelete: boolean;
  reason?: string;
} {
  const permissions = user.permissions ?? [];
  if (permissions.includes('access_admin')) {
    return { canEdit: true, canDelete: true };
  }

  if (!permissions.includes('write_operations')) {
    return {
      canEdit: false,
      canDelete: false,
      reason: 'Tu cuenta tiene permisos de solo lectura.',
    };
  }

  const isOwner = user.id === place.merchantId;
  return {
    canEdit: isOwner,
    canDelete: isOwner,
    reason: isOwner ? undefined : 'Solo puedes modificar lugares de tu propiedad.',
  };
}

/**
 * Calcula distancia de ruta en kilómetros (Haversine con factor topográfico de Colombia).
 */
export function calculateColombianDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  mode: 'vehicle' | 'bus' | 'walking'
): { distanceKm: number; durationHours: number } {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const directDist = R * c;

  // Topografía montañosa colombiana
  const sinuosity = mode === 'walking' ? 1.15 : 1.35;
  const roadDist = Math.round(directDist * sinuosity * 10) / 10;

  const speeds = {
    vehicle: 55,
    bus: 42,
    walking: 4.5,
  };
  const speed = speeds[mode] || 50;
  const durationHours = Math.round((roadDist / speed) * 10) / 10;

  return { distanceKm: roadDist, durationHours };
}

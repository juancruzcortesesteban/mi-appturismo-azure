import { AuditorPermissions, UserRole, UserSession } from './rbac';

export const AUTH_USER_KEY = 'turismo_user';
export const API_BASE = import.meta.env.VITE_API_BASE_URL
  || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `${window.location.protocol}//${window.location.hostname}:8000/api/v1`
    : '/api/v1');

export interface ApiUser {
  id: number;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  two_factor_enabled: boolean;
  permisos?: AuditorPermissions | null;
  permissions?: string[];
}

export interface ApiPermission {
  id: number;
  name: string;
  description: string;
}

export interface ApiRole {
  id: number;
  name: string;
  description: string;
  permission_ids: number[];
  permissions: string[];
}

export interface RoleCatalog {
  roles: ApiRole[];
  permissions: ApiPermission[];
  can_manage_roles: boolean;
}

export interface PasswordResetSecurityQuestion {
  requires_security_answer: boolean;
  security_question: string | null;
}

interface LoginResponse {
  status: 'authenticated' | 'mfa_required';
  role?: string | null;
  user_id?: number | null;
  full_name?: string | null;
}

export type AuthenticationResult =
  | { status: 'mfa_required' }
  | { status: 'authenticated'; user: UserSession };

export interface TwoFactorSetup {
  qr_code_data_url: string;
  manual_entry_key: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function fetchApi(url: string, options?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { credentials: 'include', ...options });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`No se pudo conectar con la API en ${API_BASE}. Verifica que FastAPI esté ejecutándose.`);
    }
    throw error;
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem('turismo_token');
    localStorage.removeItem(AUTH_USER_KEY);
  } catch (error) {
    console.error('No se pudieron eliminar las credenciales locales heredadas.', error);
  }
}

export async function parseApiResponse<T>(response: Response): Promise<T> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('El servidor devolvió una respuesta no válida.');
  }

  if (!response.ok) {
    const errorData = data as { detail?: string | { msg?: string }[] } | null;
    const detail = errorData?.detail;
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => item.msg).filter(Boolean).join(' ')
        : 'No se pudo completar la solicitud.';
    throw new ApiError(message, response.status);
  }

  return data as T;
}

function toUserSession(user: ApiUser): UserSession {
  if (
    !Number.isInteger(user.id)
    || !user.email
    || !user.full_name
    || !user.role
    || typeof user.two_factor_enabled !== 'boolean'
  ) {
    throw new Error('El perfil de usuario recibido del servidor no es válido.');
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    twoFactorEnabled: user.two_factor_enabled,
    permisos: user.permisos ?? null,
    permissions: user.permissions ?? [],
  };
}

export async function fetchCurrentUser(): Promise<UserSession> {
  const response = await fetchApi(`${API_BASE}/auth/me`);
  return toUserSession(await parseApiResponse<ApiUser>(response));
}

export async function updateMyProfile(payload: {
  email: string;
  first_name: string;
  last_name: string;
  current_password: string;
}): Promise<UserSession> {
  const response = await fetchApi(`${API_BASE}/users/me/update`, {
    method: 'PUT',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify(payload),
  });
  return toUserSession(await parseApiResponse<ApiUser>(response));
}

export async function updateMySecurityQuestion(payload: {
  question: string;
  answer: string;
  current_password: string;
}): Promise<string> {
  const response = await fetchApi(`${API_BASE}/users/me/security-question`, {
    method: 'PUT',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify(payload),
  });
  const result = await parseApiResponse<{ message: string }>(response);
  if (typeof result.message !== 'string') {
    throw new Error('La respuesta de configuración de seguridad no es válida.');
  }
  return result.message;
}

export function getStoredAuthHeaders(includeJsonContentType = false): HeadersInit {
  return includeJsonContentType ? { 'Content-Type': 'application/json' } : {};
}

export async function fetchAdminUsers(): Promise<ApiUser[]> {
  const response = await fetchApi(`${API_BASE}/auth/users`, {
    headers: getStoredAuthHeaders(),
  });
  const users = await parseApiResponse<ApiUser[]>(response);

  if (!Array.isArray(users) || users.some((user) => (
    !Number.isInteger(user.id)
    || !user.email
    || !user.full_name
    || !user.role
    || typeof user.two_factor_enabled !== 'boolean'
    || typeof user.is_active !== 'boolean'
  ))) {
    throw new Error('La lista de usuarios recibida del servidor no es válida.');
  }

  return users;
}

export async function createAdminUser(payload: {
  full_name: string;
  email: string;
  password: string;
  role: string;
  permisos?: AuditorPermissions | null;
}): Promise<ApiUser> {
  const response = await fetchApi(`${API_BASE}/auth/users`, {
    method: 'POST',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify(payload),
  });
  const user = await parseApiResponse<ApiUser>(response);

  if (
    !Number.isInteger(user.id)
    || !user.email
    || !user.full_name
    || !user.role
    || typeof user.two_factor_enabled !== 'boolean'
    || typeof user.is_active !== 'boolean'
  ) {
    throw new Error('El usuario creado recibido del servidor no es válido.');
  }

  return user;
}

export async function updateAdminUserRole(userId: number, role: string): Promise<ApiUser> {
  const response = await fetchApi(`${API_BASE}/auth/users/${userId}/role`, {
    method: 'PATCH',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify({ role }),
  });
  const user = await parseApiResponse<ApiUser>(response);

  if (
    !Number.isInteger(user.id)
    || user.id !== userId
    || !user.email
    || !user.full_name
    || !user.role
    || typeof user.two_factor_enabled !== 'boolean'
    || typeof user.is_active !== 'boolean'
  ) {
    throw new Error('El usuario actualizado recibido del servidor no es válido.');
  }

  return user;
}

export async function fetchRoleCatalog(): Promise<RoleCatalog> {
  const response = await fetchApi(`${API_BASE}/admin/roles`);
  const catalog = await parseApiResponse<RoleCatalog>(response);
  if (
    !catalog
    || !Array.isArray(catalog.roles)
    || !Array.isArray(catalog.permissions)
    || typeof catalog.can_manage_roles !== 'boolean'
    || catalog.roles.some((role) => (
      !Number.isInteger(role.id)
      || typeof role.name !== 'string'
      || !Array.isArray(role.permission_ids)
      || !Array.isArray(role.permissions)
    ))
    || catalog.permissions.some((permission) => (
      !Number.isInteger(permission.id)
      || typeof permission.name !== 'string'
      || typeof permission.description !== 'string'
    ))
  ) {
    throw new Error('El catálogo de roles recibido del servidor no es válido.');
  }
  return catalog;
}

export async function createCustomRole(payload: {
  name: string;
  description: string;
  permission_ids: number[];
}): Promise<ApiRole> {
  const response = await fetchApi(`${API_BASE}/admin/roles`, {
    method: 'POST',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify(payload),
  });
  return parseApiResponse<ApiRole>(response);
}

export async function deleteCustomRole(roleId: number): Promise<{
  role_id: number;
  role_name: string;
  reassigned_users: number;
}> {
  const response = await fetchApi(`${API_BASE}/admin/roles/${roleId}`, {
    method: 'DELETE',
  });
  const result = await parseApiResponse<{
    role_id: number;
    role_name: string;
    reassigned_users: number;
  }>(response);
  if (
    result.role_id !== roleId
    || typeof result.role_name !== 'string'
    || !Number.isInteger(result.reassigned_users)
    || result.reassigned_users < 0
  ) {
    throw new Error('La respuesta de eliminación del rol no es válida.');
  }
  return result;
}

export async function resetAdminUserPassword(userId: number, password: string): Promise<void> {
  const response = await fetchApi(`${API_BASE}/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify({ password }),
  });
  const result = await parseApiResponse<{ user_id: number; message: string }>(response);
  if (result.user_id !== userId || typeof result.message !== 'string') {
    throw new Error('La respuesta del restablecimiento de contraseña no es válida.');
  }
}

export async function updateUserPermissions(
  userId: number,
  permissionIds: number[],
): Promise<string[]> {
  const response = await fetchApi(`${API_BASE}/admin/users/${userId}/permissions`, {
    method: 'PUT',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify({ permission_ids: permissionIds }),
  });
  const result = await parseApiResponse<{ user_id: number; permissions: string[] }>(response);
  if (result.user_id !== userId || !Array.isArray(result.permissions)) {
    throw new Error('Los permisos actualizados recibidos del servidor no son válidos.');
  }
  return result.permissions;
}

export async function authenticate(email: string, password: string): Promise<AuthenticationResult> {
  const response = await fetchApi(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const result = await parseApiResponse<LoginResponse>(response);

  if (result.status === 'mfa_required') {
    return { status: 'mfa_required' };
  }
  if (
    result.status !== 'authenticated'
    || !result.role
    || !Number.isInteger(result.user_id)
    || !result.full_name
  ) {
    throw new Error('El servidor no devolvió una sesión válida.');
  }

  const user = await fetchCurrentUser();
  if (user.role !== result.role || user.id !== result.user_id || user.fullName !== result.full_name) {
    throw new Error('El perfil y el token no coinciden. Vuelve a iniciar sesión.');
  }
  return { status: 'authenticated', user };
}

export async function completeTwoFactorLogin(code: string): Promise<UserSession> {
  const response = await fetchApi(`${API_BASE}/auth/2fa/authenticate`, {
    method: 'POST',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify({ code }),
  });
  const result = await parseApiResponse<LoginResponse>(response);
  if (
    result.status !== 'authenticated'
    || !result.role
    || !Number.isInteger(result.user_id)
    || !result.full_name
  ) {
    throw new Error('El servidor no devolvió una sesión válida tras verificar el código.');
  }
  const user = await fetchCurrentUser();
  if (user.role !== result.role || user.id !== result.user_id || user.fullName !== result.full_name) {
    throw new Error('El perfil y la sesión verificada no coinciden. Vuelve a iniciar sesión.');
  }
  return user;
}

export async function setupTwoFactorAuthentication(): Promise<TwoFactorSetup> {
  const response = await fetchApi(`${API_BASE}/auth/2fa/setup`, { method: 'POST' });
  const result = await parseApiResponse<TwoFactorSetup>(response);
  if (
    typeof result.qr_code_data_url !== 'string'
    || !result.qr_code_data_url.startsWith('data:image/png;base64,')
    || typeof result.manual_entry_key !== 'string'
  ) {
    throw new Error('La configuración de autenticación en dos pasos recibida no es válida.');
  }
  return result;
}

export async function verifyAndActivateTwoFactorAuthentication(code: string): Promise<void> {
  const response = await fetchApi(`${API_BASE}/auth/2fa/verify-activate`, {
    method: 'POST',
    headers: getStoredAuthHeaders(true),
    body: JSON.stringify({ code }),
  });
  const result = await parseApiResponse<{ two_factor_enabled: boolean }>(response);
  if (result.two_factor_enabled !== true) {
    throw new Error('El servidor no confirmó la activación de la autenticación en dos pasos.');
  }
}

export async function logout(): Promise<void> {
  const response = await fetchApi(`${API_BASE}/auth/logout`, { method: 'POST' });
  if (!response.ok) await parseApiResponse<never>(response);
}

export async function requestPasswordReset(email: string): Promise<string> {
  const response = await fetchApi(`${API_BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const result = await parseApiResponse<{ message: string }>(response);
  if (typeof result.message !== 'string') {
    throw new Error('El servidor devolvió una respuesta no válida.');
  }
  return result.message;
}

export async function fetchPasswordResetSecurityQuestion(
  token: string,
): Promise<PasswordResetSecurityQuestion> {
  const query = new URLSearchParams({ token });
  const response = await fetchApi(`${API_BASE}/auth/reset-password/security-question?${query}`);
  const result = await parseApiResponse<PasswordResetSecurityQuestion>(response);
  if (
    typeof result.requires_security_answer !== 'boolean'
    || (result.security_question !== null && typeof result.security_question !== 'string')
  ) {
    throw new Error('La información de recuperación recibida del servidor no es válida.');
  }
  return result;
}

export async function resetPassword(
  token: string,
  password: string,
  securityAnswer?: string,
): Promise<string> {
  const response = await fetchApi(`${API_BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      password,
      ...(securityAnswer ? { security_answer: securityAnswer } : {}),
    }),
  });
  const result = await parseApiResponse<{ message: string }>(response);
  if (typeof result.message !== 'string') {
    throw new Error('El servidor devolvió una respuesta no válida.');
  }
  return result.message;
}

export async function registerAccount(payload: {
  email: string;
  full_name: string;
  password: string;
  role: Exclude<UserRole, 'Administrador' | 'Auditor' | 'SuperAdmin'>;
}): Promise<void> {
  const response = await fetchApi(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await parseApiResponse<ApiUser>(response);
}

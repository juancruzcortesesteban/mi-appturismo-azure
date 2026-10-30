/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { HomeView } from './components/HomeView';
import { PlacesView } from './components/PlacesView';
import { ChatWidget } from './components/ChatWidget';
import { RbacToastContainer, ToastMessage } from './components/RbacToast';
import { UserRole, UserSession, canAccessView } from './utils/rbac';
import { ApiError, clearStoredSession, fetchCurrentUser, logout } from './utils/auth';
import { useIdleTimeout } from './utils/useIdleTimeout';
import { Compass, ShieldCheck } from 'lucide-react';

const MerchantView = lazy(() => import('./components/MerchantView').then((module) => ({ default: module.MerchantView })));
const AdminView = lazy(() => import('./components/AdminView').then((module) => ({ default: module.AdminView })));
const CodeViewer = lazy(() => import('./components/CodeViewer').then((module) => ({ default: module.CodeViewer })));
const ProfileView = lazy(() => import('./components/ProfileView').then((module) => ({ default: module.ProfileView })));

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [activeView, setActiveView] = useState<'index' | 'places' | 'merchant' | 'admin' | 'code'>('index');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [authPromptVersion, setAuthPromptVersion] = useState(0);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const currentRole: UserRole = currentUser?.role || 'Turista';

  useEffect(() => {
    let isMounted = true;
    let isCheckingSession = false;
    const synchronizeSession = (initialCheck = false) => {
      if (isCheckingSession || (!initialCheck && document.visibilityState === 'hidden')) return;
      isCheckingSession = true;
      fetchCurrentUser()
        .then((user) => {
          if (isMounted) setCurrentUser(user);
        })
        .catch((error: unknown) => {
          if (!isMounted) return;
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            setCurrentUser(null);
            return;
          }
          console.error('No se pudo validar la sesión con el servidor.', error);
          setToasts((previous) => [...previous, {
            id: Math.random().toString(36).substring(2, 9),
            title: 'No se pudo validar la sesión',
            message: error instanceof Error ? error.message : 'Verifica la conexión e inténtalo de nuevo.',
            isWarning: true,
          }]);
        })
        .finally(() => {
          isCheckingSession = false;
          if (isMounted && initialCheck) setIsAuthLoading(false);
        });
    };

    const handleWindowFocus = () => synchronizeSession();
    const handleVisibilityChange = () => synchronizeSession();
    clearStoredSession();
    synchronizeSession(true);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      isMounted = false;
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const addToast = (title: string, message: string, isWarning = false) => {
    const newToast: ToastMessage = {
      id: Math.random().toString(36).substring(2, 9),
      title,
      message,
      isWarning,
    };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
    }, 4500);
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Interceptor de navegación RBAC estricto
  const handleNavigate = (view: 'index' | 'places' | 'merchant' | 'admin' | 'code') => {
    if (!currentUser && (view === 'merchant' || view === 'admin')) {
      addToast('Inicia sesión para continuar', 'Esta sección requiere una cuenta con el rol autorizado.', true);
      return;
    }

    const check = canAccessView(
      currentRole,
      view,
      currentUser?.permisos,
      currentUser?.permissions,
    );
    if (!check.allowed) {
      addToast('Acceso Denegado (RBAC Guard)', check.reason || 'Permisos insuficientes.', false);
      return;
    }

    setActiveView(view);
  };

  const handleAuthenticated = (user: UserSession) => {
    setCurrentUser(user);
    setIsAuthLoading(false);
    addToast('Sesión iniciada', `Bienvenido/a, ${user.fullName}.`, false);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.warn('La sesión local se cerró, pero el servidor no confirmó el logout.', error);
    } finally {
      clearStoredSession();
      setCurrentUser(null);
      setActiveView('index');
      setAuthPromptVersion((version) => version + 1);
      addToast('Sesión cerrada', 'Has cerrado tu sesión correctamente.', false);
    }
  };

  const handleIdleTimeout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('No se pudo limpiar la cookie de sesión tras la inactividad.', error);
    }
    clearStoredSession();
    setCurrentUser(null);
    setActiveView('index');
    setAuthPromptVersion((version) => version + 1);
    addToast(
      'Sesión finalizada',
      'Tu sesión expiró por inactividad para proteger tu cuenta.',
      true,
    );
  };

  const handleActivityHeartbeat = async () => {
    try {
      setCurrentUser(await fetchCurrentUser());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearStoredSession();
        setCurrentUser(null);
        setActiveView('index');
        setAuthPromptVersion((version) => version + 1);
        addToast(
          'Sesión finalizada',
          error.message || 'Tu sesión ya no está activa. Inicia sesión nuevamente.',
          true,
        );
        return;
      }
      console.error('No se pudo sincronizar la actividad de la sesión.', error);
    }
  };

  useIdleTimeout(Boolean(currentUser), handleIdleTimeout, handleActivityHeartbeat);

  return (
    <div className="min-h-screen bg-[#0c1017] text-[#F8F6F0] selection:bg-[#E67E22] selection:text-white flex flex-col font-sans">
      {/* Navegación Superior */}
      <Navbar
        currentUser={currentUser}
        isAuthLoading={isAuthLoading}
        authPromptVersion={authPromptVersion}
        onAuthenticated={handleAuthenticated}
        onLogout={handleLogout}
        onOpenProfile={() => setIsProfileOpen(true)}
        activeView={activeView}
        onNavigate={handleNavigate}
      />

      {isProfileOpen && currentUser && (
        <Suspense fallback={<div className="fixed inset-0 z-[120] grid place-items-center bg-[#05080c]/75 text-neutral-300">Cargando perfil...</div>}>
          <ProfileView
            user={currentUser}
            onClose={() => setIsProfileOpen(false)}
            onProfileUpdated={setCurrentUser}
            onTriggerAlert={addToast}
          />
        </Suspense>
      )}

      {/* Contenido Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8">
        {activeView === 'index' && (
          <HomeView
            onNavigate={handleNavigate}
            onTriggerAlert={addToast}
          />
        )}
        {activeView === 'places' && (
          <PlacesView
            currentRole={currentRole}
            onTriggerAlert={addToast}
          />
        )}
        {activeView === 'merchant' && (
          <Suspense fallback={<div className="py-16 text-center text-neutral-400">Cargando portal...</div>}>
          <MerchantView
            effectivePermissions={currentUser?.permissions}
            onNavigate={handleNavigate}
            onTriggerAlert={addToast}
          />
          </Suspense>
        )}
        {activeView === 'admin' && (
          <Suspense fallback={<div className="py-16 text-center text-neutral-400">Cargando administración...</div>}>
          <AdminView
            currentRole={currentRole}
            effectivePermissions={currentUser?.permissions}
            onNavigate={handleNavigate}
            onTriggerAlert={addToast}
          />
          </Suspense>
        )}
        {activeView === 'code' && (
          <Suspense fallback={<div className="py-16 text-center text-neutral-400">Cargando herramientas...</div>}>
          <CodeViewer
            currentRole={currentUser?.role || 'Turista'}
            effectivePermissions={currentUser?.permissions}
          />
          </Suspense>
        )}
      </main>

      {/* Footer Minimalista y Cultural */}
      <footer className="border-t border-white/10 bg-[#0c1017]/80 py-8 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-400">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-[#E67E22] flex items-center justify-center text-white">
              <Compass className="w-3 h-3" />
            </div>
            <span className="font-semibold text-neutral-200">Turismo Inteligente - Colombia</span>
            <span>·</span>
            <span>Seguridad Estricta de Roles (RBAC)</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-neutral-500">FastAPI &amp; Python · React · Vite</span>
            <span className="inline-flex items-center gap-1 text-[#10B981]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>RBAC Activo</span>
            </span>
          </div>
        </div>
      </footer>

      {/* Alertas RBAC Flotantes */}
      <RbacToastContainer toasts={toasts} onDismiss={handleDismissToast} />

      {/* Chatbot Guía Turístico Inteligente Gemini */}
      <ChatWidget />
    </div>
  );
}

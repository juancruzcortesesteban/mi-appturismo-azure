import React, { useEffect, useState } from 'react';
import { UserSession } from '../utils/rbac';
import { AuthModal } from './AuthModal';
import { Compass, ShieldCheck, Store, MapPin, Code2, LogOut, UserRound, Contact } from 'lucide-react';

interface NavbarProps {
  currentUser: UserSession | null;
  isAuthLoading: boolean;
  authPromptVersion: number;
  onAuthenticated: (user: UserSession) => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  activeView: 'index' | 'places' | 'merchant' | 'admin' | 'code';
  onNavigate: (view: 'index' | 'places' | 'merchant' | 'admin' | 'code') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  isAuthLoading,
  authPromptVersion,
  onAuthenticated,
  onLogout,
  onOpenProfile,
  activeView,
  onNavigate,
}) => {
  const [isAuthOpen, setIsAuthOpen] = useState(() => (
    new URLSearchParams(window.location.search).has('token')
    || new URLSearchParams(window.location.search).has('reset_token')
  ));

  useEffect(() => {
    if (authPromptVersion > 0) setIsAuthOpen(true);
  }, [authPromptVersion]);
  const canManagePlaces = currentUser?.permissions?.includes('access_merchant') === true;
  const isAdmin = currentUser?.permissions?.includes('access_admin') === true;
  const canViewCode = currentUser?.permissions?.includes('access_rbac') === true;

  const linkClass = (view: typeof activeView) => `text-sm font-medium transition-colors cursor-pointer py-1 ${
    activeView === view
      ? 'text-[#E67E22] font-semibold border-b-2 border-[#E67E22]'
      : 'text-neutral-400 hover:text-[#F8F6F0]'
  }`;

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0c1017]/85 backdrop-blur-md transition-all duration-300">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:flex-nowrap sm:gap-6 sm:px-6 lg:px-8">
          <button
            onClick={() => onNavigate('index')}
            className="group flex cursor-pointer items-center gap-3 text-left focus:outline-none"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#E67E22] to-[#D4AF37] text-white shadow-lg shadow-[#E67E22]/30 transition-transform group-hover:scale-105">
              <Compass className="h-5 w-5" />
            </div>
            <span className="flex items-center gap-1.5 font-display text-lg font-bold tracking-tight text-[#F8F6F0]">
              Turismo Colombia
            </span>
          </button>

          <nav className="hidden items-center gap-6 md:flex">
            <button onClick={() => onNavigate('index')} className={linkClass('index')}>Inicio</button>
            <button onClick={() => onNavigate('places')} className={linkClass('places')}>Lugares &amp; Rutas</button>
            {canManagePlaces && (
              <button
                onClick={() => onNavigate('merchant')}
                className={`flex cursor-pointer items-center gap-1.5 py-1 text-sm font-medium transition-colors ${activeView === 'merchant' ? 'border-b-2 border-[#10B981] font-semibold text-[#10B981]' : 'text-neutral-400 hover:text-[#F8F6F0]'}`}
              >
                <Store className="h-3.5 w-3.5 text-[#10B981]" />
                Portal Comerciante
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => onNavigate('admin')}
                className={`flex cursor-pointer items-center gap-1.5 py-1 text-sm font-medium transition-colors ${activeView === 'admin' ? 'border-b-2 border-[#D4AF37] font-semibold text-[#D4AF37]' : 'text-neutral-400 hover:text-[#F8F6F0]'}`}
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[#D4AF37]" />
                Administración
              </button>
            )}
            {canViewCode && (
              <button onClick={() => onNavigate('code')} className={linkClass('code')}>
                <span className="flex items-center gap-1.5"><Code2 className="h-3.5 w-3.5 text-orange-400" />Archivos RBAC</span>
              </button>
            )}
          </nav>

          <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto sm:gap-3">
            {!isAuthLoading && currentUser ? (
              <>
                <div className="flex max-w-[100px] flex-col items-end sm:max-w-44">
                  <span className="max-w-full truncate text-[11px] font-semibold text-[#F8F6F0] sm:text-sm" title={currentUser.fullName}>
                    {currentUser.fullName}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    currentUser.role === 'SuperAdmin'
                      ? 'border-purple-400/40 bg-purple-500/15 text-purple-300'
                      : currentUser.role === 'Administrador'
                      ? 'border-[#D4AF37]/40 bg-[#D4AF37]/15 text-[#D4AF37]'
                      : currentUser.role === 'Auditor'
                      ? 'border-sky-400/40 bg-sky-500/15 text-sky-300'
                      : currentUser.role === 'Comerciante'
                        ? 'border-[#059669]/40 bg-[#059669]/15 text-[#10B981]'
                        : 'border-[#E67E22]/40 bg-[#E67E22]/15 text-[#E67E22]'
                  }`}>
                    {currentUser.role}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onOpenProfile}
                  aria-label="Abrir mi perfil"
                  title="Mi Perfil"
                  className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-[#F8F6F0] transition hover:border-[#D4AF37]/40 hover:bg-[#D4AF37]/10"
                >
                  <Contact className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Mi Perfil</span>
                </button>
                <button
                  onClick={onLogout}
                  className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-[#F8F6F0] transition hover:border-[#E67E22]/40 hover:bg-[#E67E22]/10"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Cerrar Sesión</span>
                  <span className="sm:hidden">Salir</span>
                </button>
              </>
            ) : !isAuthLoading ? (
              <button
                onClick={() => setIsAuthOpen(true)}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-[#E67E22] to-[#D35400] px-3.5 py-2.5 text-xs font-bold text-white shadow-md shadow-[#E67E22]/25 transition hover:scale-[1.02] hover:brightness-110 active:scale-[0.98] sm:px-4 sm:text-sm"
              >
                <UserRound className="h-4 w-4" />
                Iniciar Sesión / Registrarse
              </button>
            ) : (
              <span className="h-10 w-36 animate-pulse rounded-xl bg-white/5" aria-label="Validando sesión" />
            )}

            <button
              onClick={() => onNavigate('places')}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#E67E22] to-[#D35400] px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-[#E67E22]/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>Explorar</span>
            </button>
          </div>
        </div>
      </header>
      {isAuthOpen && (
        <AuthModal
          onClose={() => setIsAuthOpen(false)}
          onAuthenticated={(user) => {
            setIsAuthOpen(false);
            onAuthenticated(user);
          }}
        />
      )}
    </>
  );
};

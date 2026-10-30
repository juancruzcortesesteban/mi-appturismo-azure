import React, { FormEvent, useMemo, useState } from 'react';
import { CheckCircle, Loader2, LockKeyhole, Save, ShieldCheck, UserRound, X } from 'lucide-react';
import {
  setupTwoFactorAuthentication,
  updateMyProfile,
  updateMySecurityQuestion,
  verifyAndActivateTwoFactorAuthentication,
} from '../utils/auth';
import { UserSession } from '../utils/rbac';

interface ProfileViewProps {
  user: UserSession;
  onClose: () => void;
  onProfileUpdated: (user: UserSession) => void;
  onTriggerAlert: (title: string, message: string, isWarning?: boolean) => void;
}

const splitName = (fullName: string) => {
  const [firstName = '', ...lastNameParts] = fullName.trim().split(/\s+/);
  return { firstName, lastName: lastNameParts.join(' ') };
};

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  onClose,
  onProfileUpdated,
  onTriggerAlert,
}) => {
  const initialName = useMemo(() => splitName(user.fullName), [user.fullName]);
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [confirmAnswer, setConfirmAnswer] = useState('');
  const [securityCurrentPassword, setSecurityCurrentPassword] = useState('');
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [twoFactorQrCode, setTwoFactorQrCode] = useState('');
  const [twoFactorManualKey, setTwoFactorManualKey] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [isTwoFactorSetupOpen, setIsTwoFactorSetupOpen] = useState(false);
  const [isLoadingTwoFactorSetup, setIsLoadingTwoFactorSetup] = useState(false);
  const [isActivatingTwoFactor, setIsActivatingTwoFactor] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState('');
  const canConfigureSecurity = user.permissions?.includes('manage_security_questions') === true;
  const canChangeEmail = !['superadmin', 'administrador'].includes(user.role.trim().toLocaleLowerCase());
  const twoFactorEnabled = user.twoFactorEnabled === true;

  const handleStartTwoFactorSetup = async () => {
    setTwoFactorError('');
    setIsLoadingTwoFactorSetup(true);
    try {
      const setup = await setupTwoFactorAuthentication();
      setTwoFactorQrCode(setup.qr_code_data_url);
      setTwoFactorManualKey(setup.manual_entry_key);
      setTwoFactorCode('');
      setIsTwoFactorSetupOpen(true);
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : 'No se pudo iniciar la configuración de 2FA.');
    } finally {
      setIsLoadingTwoFactorSetup(false);
    }
  };

  const handleActivateTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(twoFactorCode)) {
      setTwoFactorError('Ingresa el código de seis dígitos de tu aplicación.');
      return;
    }
    setTwoFactorError('');
    setIsActivatingTwoFactor(true);
    try {
      await verifyAndActivateTwoFactorAuthentication(twoFactorCode);
      onProfileUpdated({ ...user, twoFactorEnabled: true });
      setIsTwoFactorSetupOpen(false);
      setTwoFactorQrCode('');
      setTwoFactorManualKey('');
      setTwoFactorCode('');
      onTriggerAlert('Autenticación en dos pasos activada', 'Tu cuenta ahora requiere un código autenticador al iniciar sesión.', false);
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : 'No se pudo verificar el código.');
    } finally {
      setIsActivatingTwoFactor(false);
    }
  };

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileError('');
    if (!canChangeEmail && email.trim().toLocaleLowerCase() !== user.email.toLocaleLowerCase()) {
      setProfileError('Por motivos de seguridad, los administradores no pueden modificar su dirección de correo electrónico');
      setEmail(user.email);
      return;
    }

    setIsSavingProfile(true);
    try {
      const updatedUser = await updateMyProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: canChangeEmail ? email.trim() : user.email,
        current_password: currentPassword,
      });
      onProfileUpdated(updatedUser);
      setCurrentPassword('');
      onTriggerAlert('Perfil actualizado', 'Tus datos se actualizaron correctamente.', false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'No se pudo actualizar tu perfil.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSecuritySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSecurityError('');
    if (answer.trim() !== confirmAnswer.trim()) {
      setSecurityError('Las respuestas no coinciden.');
      return;
    }

    setIsSavingSecurity(true);
    try {
      const message = await updateMySecurityQuestion({
        question: question.trim(),
        answer: answer.trim(),
        current_password: securityCurrentPassword,
      });
      setQuestion('');
      setAnswer('');
      setConfirmAnswer('');
      setSecurityCurrentPassword('');
      onTriggerAlert('Seguridad actualizada', message, false);
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : 'No se pudo guardar la pregunta de seguridad.');
    } finally {
      setIsSavingSecurity(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] grid max-h-screen place-items-center overflow-y-auto bg-[#05080c]/75 p-4 backdrop-blur-xl"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget
          && !isSavingProfile
          && !isSavingSecurity
          && !isLoadingTwoFactorSetup
          && !isActivatingTwoFactor
        ) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[24px] border border-white/15 bg-[#141b24]/95 p-6 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:p-8"
      >
        <div className="mb-7 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/10 p-2.5 text-[#F5D76E]">
              <UserRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="profile-title" className="text-xl font-bold text-white font-display">Mi Perfil</h2>
              <p className="mt-1 text-sm text-neutral-400">
                Actualiza tus datos. Para proteger tu cuenta, confirma tu contraseña actual.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar perfil"
            disabled={isSavingProfile || isSavingSecurity || isLoadingTwoFactorSetup || isActivatingTwoFactor}
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm text-neutral-300">
              <span>Nombre</span>
              <input
                required
                minLength={1}
                maxLength={60}
                pattern="[A-Za-zÀ-ÖØ-öø-ÿĀ-ž' -]+"
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-3.5 py-2.5 text-white outline-none transition-colors focus:border-[#D4AF37]/60"
              />
            </label>
            <label className="block space-y-1.5 text-sm text-neutral-300">
              <span>Apellido</span>
              <input
                required
                minLength={1}
                maxLength={60}
                pattern="[A-Za-zÀ-ÖØ-öø-ÿĀ-ž' -]+"
                autoComplete="family-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-3.5 py-2.5 text-white outline-none transition-colors focus:border-[#D4AF37]/60"
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-sm text-neutral-300">
            <span>Correo electrónico</span>
            <input
              required
              type="email"
              maxLength={100}
              autoComplete="email"
              value={email}
              disabled={!canChangeEmail}
              onChange={(event) => setEmail(event.target.value)}
              className={`w-full rounded-xl border border-white/10 px-3.5 py-2.5 text-white outline-none transition-colors focus:border-[#D4AF37]/60 ${
                canChangeEmail
                  ? 'bg-[#0c1017]/80'
                  : 'cursor-not-allowed bg-slate-800 opacity-50'
              }`}
            />
          </label>
          <label className="block space-y-1.5 text-sm text-neutral-300">
            <span>Contraseña actual</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-3.5 py-2.5 text-white outline-none transition-colors focus:border-[#D4AF37]/60"
            />
          </label>
          {profileError && (
            <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
              {profileError}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSavingProfile}
              className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-[#E67E22] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#D35400] disabled:cursor-wait disabled:opacity-60"
            >
              {isSavingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSavingProfile ? 'Guardando...' : 'Guardar perfil'}
            </button>
          </div>
        </form>

        <section className="mt-8 border-t border-white/10 pt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-2.5 text-emerald-300">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold text-white">Autenticación en dos pasos (2FA)</h3>
                <p className="mt-1 text-sm text-neutral-400">
                  {twoFactorEnabled
                    ? 'Activa. Al iniciar sesión también necesitarás un código de tu aplicación autenticadora.'
                    : 'Protege tu inicio de sesión con Google Authenticator, Microsoft Authenticator u otra app TOTP.'}
                </p>
              </div>
            </div>
            {!twoFactorEnabled && (
              <button
                type="button"
                disabled={isLoadingTwoFactorSetup}
                onClick={handleStartTwoFactorSetup}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-2.5 text-sm font-bold text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-50"
              >
                {isLoadingTwoFactorSetup && <Loader2 className="h-4 w-4 animate-spin" />}
                {isLoadingTwoFactorSetup ? 'Preparando...' : 'Configurar 2FA'}
              </button>
            )}
          </div>
          {twoFactorError && !isTwoFactorSetupOpen && (
            <p role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
              {twoFactorError}
            </p>
          )}
        </section>

        {canConfigureSecurity && (
          <section className="mt-8 border-t border-white/10 pt-7">
            <div className="mb-5 flex items-start gap-3">
              <span className="rounded-xl border border-sky-400/20 bg-sky-500/10 p-2.5 text-sky-300">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold text-white">Pregunta de seguridad</h3>
                <p className="mt-1 text-sm text-neutral-400">
                  Se solicitará junto al enlace de correo para recuperar la contraseña administrativa.
                </p>
              </div>
            </div>
            <form onSubmit={handleSecuritySubmit} className="space-y-4">
              <label className="block space-y-1.5 text-sm text-neutral-300">
                <span>Tu pregunta</span>
                <input
                  required
                  minLength={8}
                  maxLength={255}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ej.: ¿En qué ciudad nos conocimos?"
                  className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-3.5 py-2.5 text-white outline-none transition-colors focus:border-sky-400/60"
                />
              </label>
              <label className="block space-y-1.5 text-sm text-neutral-300">
                <span>Respuesta</span>
                <input
                  required
                  type="password"
                  minLength={2}
                  maxLength={128}
                  autoComplete="off"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-3.5 py-2.5 text-white outline-none transition-colors focus:border-sky-400/60"
                />
              </label>
              <label className="block space-y-1.5 text-sm text-neutral-300">
                <span>Confirma la respuesta</span>
                <input
                  required
                  type="password"
                  minLength={2}
                  maxLength={128}
                  autoComplete="off"
                  value={confirmAnswer}
                  onChange={(event) => setConfirmAnswer(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-3.5 py-2.5 text-white outline-none transition-colors focus:border-sky-400/60"
                />
              </label>
              <label className="block space-y-1.5 text-sm text-neutral-300">
                <span>Contraseña actual para confirmar</span>
                <span className="relative block">
                  <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    value={securityCurrentPassword}
                    onChange={(event) => setSecurityCurrentPassword(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 py-2.5 pl-10 pr-3.5 text-white outline-none transition-colors focus:border-sky-400/60"
                  />
                </span>
              </label>
              {securityError && (
                <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
                  {securityError}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingSecurity || answer.trim() !== confirmAnswer.trim()}
                  className="inline-flex min-w-48 items-center justify-center gap-2 rounded-xl border border-sky-400/25 bg-sky-500/10 px-4 py-2.5 text-sm font-bold text-sky-200 transition-colors hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-50"
                >
                  {isSavingSecurity ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  {isSavingSecurity ? 'Guardando...' : 'Guardar pregunta'}
                </button>
              </div>
            </form>
          </section>
        )}
        {isTwoFactorSetupOpen && (
          <div className="fixed inset-0 z-[130] grid place-items-center overflow-y-auto bg-[#05080c]/80 p-4 backdrop-blur-xl">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="two-factor-title"
              className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[24px] border border-white/15 bg-[#141b24]/95 p-6 shadow-2xl shadow-black/60 backdrop-blur-2xl"
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h3 id="two-factor-title" className="font-display text-lg font-bold text-white">Configurar autenticador</h3>
                  <p className="mt-1 text-sm text-neutral-400">Escanea el código QR con tu aplicación de autenticación.</p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar configuración de 2FA"
                  disabled={isActivatingTwoFactor}
                  onClick={() => setIsTwoFactorSetupOpen(false)}
                  className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mx-auto mb-4 flex w-fit rounded-2xl bg-white p-3">
                <img src={twoFactorQrCode} alt="Código QR de configuración TOTP" className="h-48 w-48" />
              </div>
              <p className="mb-2 text-center text-xs text-neutral-400">
                Si no puedes escanearlo, introduce esta clave manualmente:
              </p>
              <code className="mb-5 block break-all rounded-xl border border-white/10 bg-[#0c1017]/80 px-3 py-2 text-center text-xs tracking-widest text-neutral-200">
                {twoFactorManualKey}
              </code>
              <form onSubmit={handleActivateTwoFactor} className="space-y-4">
                <label className="block space-y-1.5 text-sm text-neutral-300">
                  <span>Código de verificación</span>
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={twoFactorCode}
                    onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-3.5 py-3 text-center text-lg tracking-[0.5em] text-white outline-none transition-colors focus:border-emerald-400/60"
                  />
                </label>
                {twoFactorError && (
                  <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
                    {twoFactorError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={isActivatingTwoFactor || !/^\d{6}$/.test(twoFactorCode)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
                >
                  {isActivatingTwoFactor ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  {isActivatingTwoFactor ? 'Verificando...' : 'Verificar y activar'}
                </button>
              </form>
            </section>
          </div>
        )}
      </section>
    </div>
  );
};

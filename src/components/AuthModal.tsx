import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { X, Compass, Loader2, Eye, EyeOff, ArrowLeft, MailCheck, ShieldCheck } from 'lucide-react';
import {
  ApiError,
  PasswordResetSecurityQuestion,
  authenticate,
  completeTwoFactorLogin,
  fetchPasswordResetSecurityQuestion,
  registerAccount,
  requestPasswordReset,
  resetPassword,
} from '../utils/auth';
import { UserSession } from '../utils/rbac';

const EMAIL_PATTERN = /^(?!.*--)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const isValidEmail = (email: string) => email.length <= 100 && EMAIL_PATTERN.test(email);

const passwordChecks = (password: string) => ({
  length: password.length >= 8 && password.length <= 64 && new TextEncoder().encode(password).length <= 72,
  uppercase: /[A-Z]/.test(password),
  lowercase: /[a-z]/.test(password),
  number: /\d/.test(password),
  special: /[@$!%*?&]/.test(password),
});

interface AuthModalProps {
  onClose: () => void;
  onAuthenticated: (user: UserSession) => void;
}

type AuthTab = 'login' | 'register';
type RecoveryMode = 'request' | 'reset' | null;

export const AuthModal: React.FC<AuthModalProps> = ({ onClose, onAuthenticated }) => {
  const [tab, setTab] = useState<AuthTab>('login');
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>(() => (
    new URLSearchParams(window.location.search).has('token')
    || new URLSearchParams(window.location.search).has('reset_token')
      ? 'reset'
      : null
  ));
  const [resetToken] = useState(() => {
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get('token') || searchParams.get('reset_token') || '';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState('');
  const [resetSecurityAnswer, setResetSecurityAnswer] = useState('');
  const [securityChallenge, setSecurityChallenge] = useState<PasswordResetSecurityQuestion | null>(null);
  const [isLoadingSecurityChallenge, setIsLoadingSecurityChallenge] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [isMfaRequired, setIsMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState<string[]>(['', '', '', '', '', '']);
  const mfaInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const bodyAlreadyLocked = document.body.classList.contains('overflow-hidden');
    document.body.classList.add('overflow-hidden');
    return () => {
      if (!bodyAlreadyLocked) document.body.classList.remove('overflow-hidden');
    };
  }, []);

  useEffect(() => {
    if (isMfaRequired) mfaInputRefs.current[0]?.focus();
  }, [isMfaRequired]);

  useEffect(() => {
    if (recoveryMode !== 'reset') return undefined;
    if (!resetToken) {
      setErrorMessage('El enlace de restablecimiento no es válido o ha expirado.');
      return undefined;
    }

    let isMounted = true;
    setSecurityChallenge(null);
    setIsLoadingSecurityChallenge(true);
    fetchPasswordResetSecurityQuestion(resetToken)
      .then((challenge) => {
        if (isMounted) setSecurityChallenge(challenge);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : 'No se pudo validar el enlace de recuperación.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingSecurityChallenge(false);
      });

    return () => { isMounted = false; };
  }, [recoveryMode, resetToken]);

  const registrationPasswordChecks = passwordChecks(registerPassword);
  const registrationPasswordIsValid = Object.values(registrationPasswordChecks).every(Boolean);
  const registrationPasswordRequirements: Array<{ valid: boolean; label: string }> = [
    { valid: registrationPasswordChecks.length, label: 'Entre 8 y 64 caracteres' },
    { valid: registrationPasswordChecks.uppercase, label: 'Una letra mayúscula' },
    { valid: registrationPasswordChecks.lowercase, label: 'Una letra minúscula' },
    { valid: registrationPasswordChecks.number, label: 'Un número' },
    { valid: registrationPasswordChecks.special, label: 'Un carácter especial (@$!%*?&)' },
  ];

  const finishLogin = async (email: string, password: string) => {
    const result = await authenticate(email, password);
    if (result.status === 'mfa_required') {
      setIsMfaRequired(true);
      setMfaCode(['', '', '', '', '', '']);
      setLoginPassword('');
      return;
    }
    onAuthenticated(result.user);
  };

  const handleMfaCodeChange = (index: number, value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length > 1) {
      const pastedCode = digits.slice(0, 6);
      setMfaCode(Array.from({ length: 6 }, (_, digitIndex) => pastedCode[digitIndex] ?? ''));
      mfaInputRefs.current[Math.min(pastedCode.length, 5)]?.focus();
      return;
    }
    const digit = digits.slice(-1);
    const nextCode = [...mfaCode];
    nextCode[index] = digit;
    setMfaCode(nextCode);
    if (digit && index < 5) mfaInputRefs.current[index + 1]?.focus();
  };

  const handleMfaSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = mfaCode.join('');
    if (!/^\d{6}$/.test(code)) {
      setErrorMessage('Ingresa el código de seis dígitos de tu aplicación autenticadora.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      onAuthenticated(await completeTwoFactorLogin(code));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo verificar el código.');
      setMfaCode(['', '', '', '', '', '']);
      mfaInputRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '');
    const password = String(form.get('password') || '');
    if (!isValidEmail(email) || new TextEncoder().encode(password).length > 72) {
      setErrorMessage('Verifica el correo y que la contraseña no supere el límite permitido.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await finishLogin(email, password);
    } catch (error) {
      setErrorMessage(error instanceof ApiError && error.status === 409
        ? 'Este correo electrónico ya está registrado'
        : error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '');
    const password = String(form.get('password') || '');
    if (!isValidEmail(email)) {
      setErrorMessage('Ingresa un correo válido de hasta 100 caracteres.');
      return;
    }
    if (!Object.values(passwordChecks(password)).every(Boolean)) {
      setErrorMessage('La contraseña no cumple los requisitos indicados.');
      return;
    }
    let accountCreated = false;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await registerAccount({
        email,
        full_name: String(form.get('full_name') || '').trim(),
        password,
        role: form.get('role') === 'Comerciante' ? 'Comerciante' : 'Turista',
      });
      accountCreated = true;
      await finishLogin(email, password);
    } catch (error) {
      const message = error instanceof ApiError && error.status === 409
        ? 'Este correo electrónico ya está registrado'
        : error instanceof Error ? error.message : 'No se pudo crear la cuenta.';
      setErrorMessage(accountCreated
        ? `La cuenta fue creada, pero no se pudo iniciar sesión. ${message}`
        : message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') || '');
    if (!isValidEmail(email)) {
      setErrorMessage('Ingresa un correo válido de hasta 100 caracteres.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      setStatusMessage(await requestPasswordReset(email));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo procesar la solicitud.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetToken) {
      setErrorMessage('El enlace de restablecimiento no es válido o ha expirado.');
      return;
    }
    if (!Object.values(passwordChecks(resetPasswordValue)).every(Boolean)) {
      setErrorMessage('La contraseña no cumple los requisitos indicados.');
      return;
    }
    if (resetPasswordValue !== resetPasswordConfirmation) {
      setErrorMessage('Las contraseñas no coinciden.');
      return;
    }
    if (
      securityChallenge?.requires_security_answer
      && (!securityChallenge.security_question || !resetSecurityAnswer.trim())
    ) {
      setErrorMessage(securityChallenge.security_question
        ? 'Ingresa la respuesta a tu pregunta de seguridad.'
        : 'La cuenta administrativa no tiene una pregunta de seguridad configurada. Contacta al soporte.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      setStatusMessage(await resetPassword(
        resetToken,
        resetPasswordValue,
        securityChallenge?.requires_security_answer ? resetSecurityAnswer.trim() : undefined,
      ));
      setRecoveryMode(null);
      setTab('login');
      setLoginPassword('');
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete('token');
      currentUrl.searchParams.delete('reset_token');
      window.history.replaceState(null, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo actualizar la contraseña.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startPasswordRecovery = () => {
    setRecoveryMode('request');
    setStatusMessage('');
    setErrorMessage('');
  };

  const returnToLogin = () => {
    setRecoveryMode(null);
    setStatusMessage('');
    setErrorMessage('');
    setTab('login');
  };

  const switchTab = (nextTab: AuthTab) => {
    setRecoveryMode(null);
    setTab(nextTab);
    setErrorMessage('');
    setStatusMessage('');
  };

  return (
    <div
    className="fixed inset-0 z-[100] grid max-h-screen place-items-center overflow-y-auto bg-[#05080c]/75 p-4 backdrop-blur-xl"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-[24px] border border-[#E67E22]/25 bg-[#141b24]/90 p-6 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#E67E22]">
              <Compass className="h-4 w-4" />
              Turismo Colombia
            </div>
            <h2 id="auth-title" className="font-display text-2xl font-bold text-[#F8F6F0]">
              {recoveryMode === 'request'
                ? 'Recupera tu contraseña'
                : recoveryMode === 'reset'
                  ? 'Crea una nueva contraseña'
                  : tab === 'login' ? 'Bienvenido de vuelta' : 'Crea tu cuenta'}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              {recoveryMode
                ? recoveryMode === 'request'
                  ? 'Te enviaremos instrucciones si encontramos una cuenta con ese correo.'
                  : 'Elige una contraseña segura para recuperar el acceso a tu cuenta.'
                : tab === 'login' ? 'Inicia sesión para continuar tu viaje.' : 'Únete a nuestra comunidad viajera.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-neutral-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Cerrar ventana"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!recoveryMode && (
        <div className="mb-6 grid grid-cols-2 rounded-xl border border-white/10 bg-black/20 p-1" role="tablist" aria-label="Acceso a la cuenta">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => switchTab('login')}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${tab === 'login' ? 'bg-gradient-to-r from-[#E67E22]/30 to-[#D4AF37]/15 text-white shadow-inner shadow-[#E67E22]/10' : 'text-neutral-400 hover:text-white'}`}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            onClick={() => switchTab('register')}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${tab === 'register' ? 'bg-gradient-to-r from-[#E67E22]/30 to-[#D4AF37]/15 text-white shadow-inner shadow-[#E67E22]/10' : 'text-neutral-400 hover:text-white'}`}
          >
            Registrarse
          </button>
        </div>
        )}

        {recoveryMode === 'request' ? (
          <form className="space-y-4" onSubmit={handleForgotPassword}>
            <label className="block text-sm font-medium text-neutral-300">
              Correo electrónico
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={100}
                required
                defaultValue={loginEmail}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 text-sm text-white outline-none focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
              />
            </label>
            {errorMessage && <p className="text-sm text-red-300" role="alert">{errorMessage}</p>}
            {statusMessage && (
              <p className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200" role="status">
                <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                {statusMessage}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E67E22] to-[#D35400] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#E67E22]/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar instrucciones
            </button>
            <button type="button" onClick={returnToLogin} className="mx-auto flex items-center gap-2 text-sm text-neutral-400 transition hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Volver al inicio de sesión
            </button>
          </form>
        ) : recoveryMode === 'reset' ? (
          <form className="space-y-4" onSubmit={handleResetPassword}>
            {isLoadingSecurityChallenge ? (
              <p role="status" className="flex items-center gap-2 text-sm text-neutral-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Validando el enlace de recuperación...
              </p>
            ) : securityChallenge?.requires_security_answer && securityChallenge.security_question ? (
              <fieldset className="space-y-3 rounded-xl border border-sky-400/20 bg-sky-500/[0.06] p-4">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-sky-200">
                  Verificación adicional
                </legend>
                <p className="text-sm text-white">{securityChallenge.security_question}</p>
                <label className="block text-sm font-medium text-neutral-300">
                  Tu respuesta
                  <input
                    type="password"
                    autoComplete="off"
                    required
                    maxLength={128}
                    value={resetSecurityAnswer}
                    onChange={(event) => setResetSecurityAnswer(event.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 text-sm text-white outline-none focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/15"
                  />
                </label>
              </fieldset>
            ) : null}
            <label className="block text-sm font-medium text-neutral-300">
              Nueva contraseña (8 a 64 caracteres)
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={64}
                required
                value={resetPasswordValue}
                onChange={(event) => setResetPasswordValue(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 text-sm text-white outline-none focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-300">
              Confirma la nueva contraseña
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={64}
                required
                value={resetPasswordConfirmation}
                onChange={(event) => setResetPasswordConfirmation(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 text-sm text-white outline-none focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
              />
            </label>
            <ul className="space-y-1 text-xs text-neutral-400" aria-label="Requisitos de contraseña">
              <li>Entre 8 y 64 caracteres, con mayúscula, minúscula, número y carácter especial (@$!%*?&).</li>
              <li>Las contraseñas deben coincidir.</li>
            </ul>
            {errorMessage && <p className="text-sm text-red-300" role="alert">{errorMessage}</p>}
            <button
              type="submit"
              disabled={
                isSubmitting
                || isLoadingSecurityChallenge
                || securityChallenge === null
                || (securityChallenge.requires_security_answer && !securityChallenge.security_question)
                || (securityChallenge.requires_security_answer && !resetSecurityAnswer.trim())
                || !Object.values(passwordChecks(resetPasswordValue)).every(Boolean)
                || resetPasswordValue !== resetPasswordConfirmation
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E67E22] to-[#D35400] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#E67E22]/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Actualizar contraseña
            </button>
          </form>
        ) : tab === 'login' ? (
          isMfaRequired ? (
            <form className="space-y-5" onSubmit={handleMfaSubmit}>
              <div className="text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#D4AF37]/20 bg-[#D4AF37]/10 text-[#F5D76E]">
                  <ShieldCheck className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="font-display text-lg font-bold text-white">Verificación en dos pasos</h3>
                <p className="mt-1 text-sm text-neutral-400">
                  Ingresa el código de seis dígitos de tu aplicación autenticadora.
                </p>
              </div>
              <div className="flex justify-center gap-2 sm:gap-3" aria-label="Código de autenticación">
                {Array.from({ length: 6 }, (_, index) => (
                  <input
                    key={index}
                    ref={(element) => { mfaInputRefs.current[index] = element; }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Dígito ${index + 1}`}
                    maxLength={1}
                    value={mfaCode[index]}
                    onChange={(event) => handleMfaCodeChange(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Backspace' && !mfaCode[index] && index > 0) {
                        mfaInputRefs.current[index - 1]?.focus();
                      }
                    }}
                    onPaste={(event) => {
                      const pastedCode = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                      if (!pastedCode) return;
                      event.preventDefault();
                      setMfaCode(Array.from({ length: 6 }, (_, digitIndex) => pastedCode[digitIndex] ?? ''));
                      mfaInputRefs.current[Math.min(pastedCode.length, 5)]?.focus();
                    }}
                    className="h-12 w-10 rounded-xl border border-white/10 bg-[#0c1017]/80 text-center text-lg font-bold text-white outline-none transition focus:border-[#D4AF37]/60 focus:ring-2 focus:ring-[#D4AF37]/15 sm:h-14 sm:w-12"
                  />
                ))}
              </div>
              {errorMessage && <p className="text-sm text-red-300" role="alert">{errorMessage}</p>}
              <button
                type="submit"
                disabled={isSubmitting || !/^\d{6}$/.test(mfaCode.join(''))}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E67E22] to-[#D35400] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#E67E22]/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Verificar e iniciar sesión
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setIsMfaRequired(false);
                  setMfaCode(['', '', '', '', '', '']);
                  setErrorMessage('');
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-white/10 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Volver al inicio de sesión
              </button>
            </form>
          ) : (
          <form className="space-y-4" onSubmit={handleLogin}>
            <label className="block text-sm font-medium text-neutral-300">
              Email o usuario
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={100}
                pattern="(?!.*--)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
                required
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
                placeholder="tu@correo.com"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-300">
              Contraseña
              <div className="relative mt-1.5">
                <input
                  name="password"
                  type={showLoginPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  maxLength={72}
                  required
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 pr-12 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
                  placeholder="Tu contraseña"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex items-center px-4 text-neutral-400 transition hover:text-white"
                  aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showLoginPassword}
                >
                  {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <div className="-mt-2 text-right">
              <button
                type="button"
                onClick={startPasswordRecovery}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-[#E8B578] backdrop-blur-md transition hover:border-[#E67E22]/40 hover:bg-[#E67E22]/10 hover:text-white"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            {loginEmail.length > 0 && !isValidEmail(loginEmail) && (
              <p className="text-xs text-red-300" role="alert">Ingresa un correo válido de hasta 100 caracteres.</p>
            )}
            {errorMessage && <p className="text-sm text-red-300" role="alert">{errorMessage}</p>}
            <button
              type="submit"
              disabled={isSubmitting || !isValidEmail(loginEmail) || loginPassword.length === 0 || new TextEncoder().encode(loginPassword).length > 72}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E67E22] to-[#D35400] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#E67E22]/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Iniciar Sesión
            </button>
          </form>
          )
        ) : (
          <form className="space-y-4" onSubmit={handleRegister}>
            <label className="block text-sm font-medium text-neutral-300">
              Nombre completo
              <input
                name="full_name"
                type="text"
                minLength={2}
                maxLength={100}
                autoComplete="name"
                required
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 text-sm text-white outline-none focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-300">
              Correo electrónico
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={100}
                pattern="(?!.*--)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
                required
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 text-sm text-white outline-none focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
              />
              {registerEmail.length > 0 && !isValidEmail(registerEmail) && (
                <span className="mt-1 block text-xs text-red-300" role="alert">Ingresa un correo válido de hasta 100 caracteres.</span>
              )}
            </label>
            <label className="block text-sm font-medium text-neutral-300">
              Contraseña (8 a 64 caracteres)
              <div className="relative mt-1.5">
                <input
                  name="password"
                  type={showRegisterPassword ? 'text' : 'password'}
                  minLength={8}
                  maxLength={64}
                  autoComplete="new-password"
                  required
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 pr-12 text-sm text-white outline-none focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowRegisterPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex items-center px-4 text-neutral-400 transition hover:text-white"
                  aria-label={showRegisterPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showRegisterPassword}
                >
                  {showRegisterPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <ul className="mt-2 space-y-1 text-xs" aria-label="Requisitos de contraseña">
                {registrationPasswordRequirements.map(({ valid, label }) => (
                  <li key={label} className={valid ? 'text-emerald-300' : 'text-neutral-400'}>
                    {valid ? '✓' : '•'} {label}
                  </li>
                ))}
              </ul>
            </label>
            <label className="block text-sm font-medium text-neutral-300">
              Tipo de cuenta
              <select
                name="role"
                defaultValue="Turista"
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0c1017]/80 px-4 py-3 text-sm text-white outline-none focus:border-[#E67E22] focus:ring-2 focus:ring-[#E67E22]/15"
              >
                <option value="Turista">Turista</option>
                <option value="Comerciante">Comerciante</option>
              </select>
            </label>
            {errorMessage && <p className="text-sm text-red-300" role="alert">{errorMessage}</p>}
            <button
              type="submit"
              disabled={isSubmitting || !isValidEmail(registerEmail) || !registrationPasswordIsValid}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#E67E22] to-[#D35400] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#E67E22]/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear Cuenta
            </button>
          </form>
        )}

        {!recoveryMode && statusMessage && (
          <p className="mt-4 text-sm text-emerald-200" role="status">{statusMessage}</p>
        )}

        <p className="mt-5 flex items-center justify-center gap-2 text-[11px] text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
          Acceso protegido con control de roles
        </p>
      </section>
    </div>
  );
};

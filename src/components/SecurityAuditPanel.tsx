import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock3, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import {
  AuditorReadLog,
  fetchAuditorReadLogs,
  fetchSecurityAudit,
  SecurityAuditResponse,
} from '../utils/system';
import { UserRole } from '../utils/rbac';

interface SecurityAuditPanelProps {
  currentRole: UserRole;
  permissions?: string[];
}

const formatColombiaTime = (timestamp: string) => new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'America/Bogota',
}).format(new Date(timestamp));

export const SecurityAuditPanel: React.FC<SecurityAuditPanelProps> = ({
  currentRole,
  permissions = [],
}) => {
  const [audit, setAudit] = useState<SecurityAuditResponse | null>(null);
  const [readLogs, setReadLogs] = useState<AuditorReadLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingReadLogs, setIsLoadingReadLogs] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [readLogsError, setReadLogsError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'security' | 'reads'>('security');
  const canViewReadLogs = permissions.includes('manage_roles');

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setErrorMessage('');

    fetchSecurityAudit()
      .then((result) => {
        if (isMounted) setAudit(result);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : 'No se pudo cargar el registro de auditoría.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => { isMounted = false; };
  }, [reloadKey]);

  useEffect(() => {
    if (!canViewReadLogs) {
      setIsLoadingReadLogs(false);
      return;
    }

    let isMounted = true;
    setIsLoadingReadLogs(true);
    setReadLogsError('');
    fetchAuditorReadLogs()
      .then((logs) => {
        if (isMounted) setReadLogs(logs);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setReadLogsError(error instanceof Error ? error.message : 'No se pudo cargar la auditoría de lectura.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingReadLogs(false);
      });

    return () => { isMounted = false; };
  }, [canViewReadLogs, reloadKey]);

  const metrics = [
    {
      label: 'Usuarios Registrados',
      value: audit?.total_users ?? '—',
      icon: Users,
      accent: 'text-sky-300 bg-sky-400/10 border-sky-400/20',
    },
    {
      label: 'Inicios de Sesión Hoy',
      value: audit?.logins_today ?? '—',
      icon: Activity,
      accent: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
    },
    {
      label: 'Alertas Activas · 24 h',
      value: audit?.active_alerts ?? '—',
      icon: audit?.active_alerts ? AlertTriangle : ShieldCheck,
      accent: audit?.active_alerts
        ? 'text-red-300 bg-red-400/10 border-red-400/25'
        : 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
    },
  ];

  return (
    <section className="mt-8 rounded-2xl border border-orange-400/15 bg-[#141b24]/75 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-orange-400/20 bg-orange-500/10 text-orange-300">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-orange-300">{currentRole}</p>
            <h2 className="font-display text-lg font-bold text-[#F8F6F0]">
              Centro de Monitoreo y Auditoría
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Alertas recientes de seguridad · zona horaria America/Bogota
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-orange-400/30 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      <div className="mb-6 flex gap-2 border-b border-white/[0.08]">
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
            activeTab === 'security'
              ? 'border-orange-400 text-orange-200'
              : 'border-transparent text-neutral-400 hover:text-white'
          }`}
        >
          Auditoría de Seguridad
        </button>
        {canViewReadLogs && (
          <button
            type="button"
            onClick={() => setActiveTab('reads')}
            className={`border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'reads'
                ? 'border-sky-400 text-sky-200'
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            Auditoría de Lectura
          </button>
        )}
      </div>

      {activeTab === 'reads' && canViewReadLogs ? (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c1017]/75">
          <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
            <ShieldCheck className="h-4 w-4 text-sky-300" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-white">Lecturas realizadas por Auditores</h3>
            <span className="ml-auto text-[11px] text-neutral-500">Más recientes primero · máximo 500 eventos</span>
          </div>
          {isLoadingReadLogs && <p className="px-4 py-6 text-sm text-neutral-400" role="status">Cargando lecturas...</p>}
          {!isLoadingReadLogs && readLogsError && (
            <p className="px-4 py-6 text-sm text-red-300" role="alert">{readLogsError}</p>
          )}
          {!isLoadingReadLogs && !readLogsError && readLogs.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-neutral-400">
              Aún no hay lecturas registradas por Auditores.
            </p>
          )}
          {!isLoadingReadLogs && !readLogsError && readLogs.length > 0 && (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead className="sticky top-0 bg-[#111821] text-[10px] uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Fecha y hora</th>
                    <th className="px-4 py-3 font-semibold">Auditor</th>
                    <th className="px-4 py-3 font-semibold">Módulo consultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {readLogs.map((log) => (
                    <tr key={log.id} className="transition-colors hover:bg-white/[0.025]">
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-400">
                        {formatColombiaTime(log.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-200">{log.auditor_name}</div>
                        <div className="mt-0.5 text-[11px] text-neutral-500">{log.email}</div>
                      </td>
                      <td className="px-4 py-3 text-sky-200">{log.module}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {metrics.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-neutral-400">{label}</span>
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg border ${accent}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tabular-nums text-white">
              {isLoading && !audit ? '…' : value}
            </div>
            {label.startsWith('Alertas') && (
              <p className="mt-1 text-[11px] text-neutral-500">Detecciones de las últimas 24 horas</p>
            )}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c1017]/75">
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
          <Clock3 className="h-4 w-4 text-orange-300" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-white">Actividad reciente</h3>
          <span className="ml-auto text-[11px] text-neutral-500">Más recientes primero · máximo 250 eventos</span>
        </div>

        {isLoading && <p className="px-4 py-6 text-sm text-neutral-400" role="status">Cargando auditoría...</p>}
        {!isLoading && errorMessage && (
          <div className="px-4 py-6 text-sm text-red-300" role="alert">
            {errorMessage}
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="ml-2 font-semibold underline underline-offset-2 hover:text-white"
            >
              Reintentar
            </button>
          </div>
        )}
        {!isLoading && !errorMessage && audit?.logs.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-neutral-400">
            Aún no hay eventos registrados.
          </p>
        )}
        {!isLoading && audit && audit.logs.length > 0 && (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="sticky top-0 bg-[#111821] text-[10px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Correo</th>
                  <th className="px-4 py-3 font-semibold">Acción</th>
                  <th className="px-4 py-3 font-semibold">Fecha y hora</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {audit.logs.map((log) => (
                  <tr key={log.id} className="transition-colors hover:bg-white/[0.025]">
                    <td className="px-4 py-3 font-medium text-neutral-200">{log.email}</td>
                    <td className="px-4 py-3 text-neutral-300">
                      <div>{log.event === 'AUDITOR_READ' ? 'Auditoría de Lectura' : log.event}</div>
                      {(log.alert_reason || log.details) && (
                        <div className={`mt-1 text-[11px] ${log.is_suspicious ? 'text-red-300' : 'text-neutral-500'}`}>
                          {log.alert_reason || log.details}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-400">
                      {formatColombiaTime(log.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                        log.is_suspicious
                          ? 'border-red-400/30 bg-red-400/10 text-red-300'
                          : log.status === 'Exitoso'
                            ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                            : 'border-amber-400/25 bg-amber-400/10 text-amber-300'
                      }`}>
                        {log.is_suspicious ? 'Sospechoso' : log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}
    </section>
  );
};

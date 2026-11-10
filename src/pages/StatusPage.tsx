// src/pages/StatusPage.tsx
import React, { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

export const StatusPage: React.FC = () => {
  const { me, reloadMe } = useAuth();
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  const [integrations, setIntegrations] = useState<unknown>(null);
  const [clearanceInfo, setClearanceInfo] = useState<unknown>(null);
  const [checkResult, setCheckResult] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await apiFetch('/meta/health', { skipAuth: true });
        setApiUp(true);
      } catch {
        setApiUp(false);
      }

      if (me) {
        try {
          const [intRes, clrRes] = await Promise.all([
            apiFetch('/integrations/status'),
            apiFetch('/clearance'),
          ]);
          setIntegrations(intRes.data);
          setClearanceInfo(clrRes.data);
        } catch {
          // Ignorar si aún no carga
        }
      }
    })();
  }, [me]);

  const handleRunClearanceCheck = async () => {
    setChecking(true);
    setErrorMsg(null);
    try {
      const { data } = await apiFetch('/clearance/check', { method: 'POST' });
      setCheckResult(data);
      await reloadMe();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(`${err.body.error}: ${err.body.message}`);
        setCheckResult(err.body.details);
      } else {
        setErrorMsg('Error al ejecutar la revisión automática.');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Estado del Sistema y Clearance</h1>

      <section className="bg-slate-900 border border-slate-800 rounded p-4 space-y-2">
        <p>
          <strong>Build desplegado (X-Lumon-Build):</strong>{' '}
          <code className="px-2 py-0.5 bg-slate-800 rounded text-teal-300">{__LUMON_BUILD__}</code>
        </p>
        <p>
          <strong>Estado de la API (/meta/health):</strong>{' '}
          {apiUp === null ? 'Comprobando…' : apiUp ? 'Operativa (OK)' : 'Sin respuesta'}
        </p>
        <p>
          <strong>Cuadrilla:</strong> {me?.team.code ?? 'Sin sesión'} —{' '}
          <strong>Clearance otorgada:</strong> {me?.clearance.granted ? 'Sí' : 'No'}
        </p>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Revisión Automática (CP3)</h2>
          <button
            type="button"
            onClick={() => void handleRunClearanceCheck()}
            disabled={checking}
            className="px-4 py-2 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold text-white"
          >
            {checking ? 'Verificando…' : 'Abrir el Piso de Pruebas'}
          </button>
        </div>

        {errorMsg && (
          <div role="alert" className="p-3 rounded bg-red-950 border border-red-700 text-red-200 text-sm">
            {errorMsg}
          </div>
        )}

        {Boolean(checkResult) && (
          <pre className="p-3 bg-slate-950 rounded text-xs overflow-auto border border-slate-800">
            {JSON.stringify(checkResult, null, 2)}
          </pre>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded p-4">
          <h2 className="font-semibold mb-2">Estado de Integraciones</h2>
          <pre className="text-xs bg-slate-950 p-3 rounded overflow-auto">
            {JSON.stringify(integrations, null, 2)}
          </pre>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded p-4">
          <h2 className="font-semibold mb-2">Estado de Clearance y Rondas</h2>
          <pre className="text-xs bg-slate-950 p-3 rounded overflow-auto">
            {JSON.stringify(clearanceInfo, null, 2)}
          </pre>
        </div>
      </section>
    </main>
  );
};
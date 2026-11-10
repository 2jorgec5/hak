// src/context/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  apiFetch,
  clearSessionTokens,
  onSessionTerminated,
  refreshAccessToken,
  setSessionTokens,
} from '../api/client';

export interface MeResponse {
  user?: { id: number; email: string; displayName: string };
  team: { code: string; name: string };
  role: { code: string; name: string };
  permissions: string[];
  clearance: { granted: boolean; grantedAt: string | null };
}

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  revokedReason: string | null;
  hasPermission: (perm: string) => boolean;
  loginWithTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthError, setHealthError] = useState(false);
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [revokedReason, setRevokedReason] = useState<string | null>(null);

  const checkHealthAndSession = useCallback(async () => {
    try {
      await apiFetch('/meta/health', { skipAuth: true });
      setHealthError(false);
    } catch {
      setHealthError(true);
      return;
    }

    setLoading(true);
    try {
      const hasRt = localStorage.getItem('lumon_rt');
      if (!hasRt) {
        setMe(null);
        return;
      }
      const token = await refreshAccessToken();
      if (!token) {
        setMe(null);
        return;
      }
      const { data } = await apiFetch<MeResponse>('/auth/me');
      setMe(data);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkHealthAndSession();
  }, [checkHealthAndSession]);

  // Reintento automático con espera creciente si /meta/health falla
  useEffect(() => {
    if (!healthError) return;
    const delay = Math.min(16000, 1000 * Math.pow(2, healthAttempt));
    const timer = window.setTimeout(() => {
      setHealthAttempt((a) => a + 1);
      void checkHealthAndSession();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [healthError, healthAttempt, checkHealthAndSession]);

  useEffect(() => {
    return onSessionTerminated((reason) => {
      setMe(null);
      if (reason === 'REFRESH_REUSED') {
        setRevokedReason('Se detectó un token de refresco reutilizado (REFRESH_REUSED). Por seguridad se cerró la sesión en todas las pestañas.');
      } else if (reason === 'SESSION_REVOKED') {
        setRevokedReason('Tu sesión fue revocada por Lumon Industries (SESSION_REVOKED).');
      }
    });
  }, []);

  const reloadMe = useCallback(async () => {
    const { data } = await apiFetch<MeResponse>('/auth/me');
    setMe(data);
  }, []);

  const loginWithTokens = useCallback(async (access: string, refresh: string) => {
    setRevokedReason(null);
    setSessionTokens(access, refresh);
    const { data } = await apiFetch<MeResponse>('/auth/me');
    setMe(data);
  }, []);

  const logout = useCallback(async () => {
    try {
      const rt = localStorage.getItem('lumon_rt');
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: rt }),
      });
    } catch {
      // Ignoramos error de red al cerrar sesión local
    } finally {
      clearSessionTokens();
      setMe(null);
    }
  }, []);

  const hasPermission = useCallback(
    (perm: string) => Boolean(me?.permissions.includes(perm)),
    [me]
  );

  if (healthError) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Conectando con Lumon…</h1>
        <p className="text-slate-400 mb-6">
          El servidor del piso separado no responde aún. Reintentando automáticamente (intento {healthAttempt + 1})…
        </p>
        <button
          type="button"
          onClick={() => void checkHealthAndSession()}
          className="px-4 py-2 rounded bg-teal-600 hover:bg-teal-500 font-medium text-white"
        >
          Reintentar ahora
        </button>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-lg font-mono animate-pulse">Verificando credenciales de separación…</p>
      </main>
    );
  }

  return (
    <AuthContext.Provider
      value={{ me, loading, revokedReason, hasPermission, loginWithTokens, logout, reloadMe }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}   
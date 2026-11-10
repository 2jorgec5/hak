// src/pages/AuthPages.tsx
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface AuthSuccessResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export const LoginPage: React.FC = () => {
  const { loginWithTokens, revokedReason } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const returnTo = searchParams.get('returnTo') || '/files';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const { data } = await apiFetch<AuthSuccessResponse>('/auth/login', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({ email, password }),
      });
      await loginWithTokens(data.accessToken, data.refreshToken);
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(err.body.message || err.body.error);
      } else {
        setErrorMsg('No se pudo iniciar sesión.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg p-6 shadow-xl">
        <h1 className="text-2xl font-bold mb-1">Lumon Industries — MDR</h1>
        <p className="text-sm text-slate-400 mb-6">Acceso al piso separado</p>

        {revokedReason && (
          <div role="alert" className="mb-4 p-3 rounded bg-amber-950 border border-amber-700 text-amber-200 text-sm">
            {revokedReason}
          </div>
        )}

        {errorMsg && (
          <div role="alert" className="mb-4 p-3 rounded bg-red-950 border border-red-700 text-red-200 text-sm">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium mb-1">
              Correo electrónico
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium mb-1">
              Contraseña
            </label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-slate-100"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 px-4 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold text-white"
          >
            {submitting ? 'Ingresando…' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-400 text-center">
          ¿Tu cuadrilla aún no tiene cuenta?{' '}
          <Link to="/register" className="text-teal-400 underline">
            Registrar cuadrilla
          </Link>
        </p>
      </div>
    </main>
  );
};

export const RegisterPage: React.FC = () => {
  const { loginWithTokens } = useAuth();
  const navigate = useNavigate();

  const [teamName, setTeamName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);

    try {
      const { data } = await apiFetch<AuthSuccessResponse>('/auth/register', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({
          teamName,
          name: teamName,
          displayName: displayName || teamName,
          email,
          password,
        }),
      });
      await loginWithTokens(data.accessToken, data.refreshToken);
      navigate('/files', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.body.details as Record<string, string> | null;
        if (details && typeof details === 'object') {
          setFieldErrors(details);
        }
        setGeneralError(err.body.message || err.body.error);
      } else {
        setGeneralError('Error al registrar la cuadrilla.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg p-6 shadow-xl">
        <h1 className="text-2xl font-bold mb-1">Registro de Cuadrilla MDR</h1>
        <p className="text-sm text-slate-400 mb-6">Inscribe tu equipo en Lumon Industries</p>

        {generalError && (
          <div role="alert" className="mb-4 p-3 rounded bg-red-950 border border-red-700 text-red-200 text-sm">
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reg-team" className="block text-sm font-medium mb-1">
              Nombre de la cuadrilla
            </label>
            <input
              id="reg-team"
              type="text"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-slate-100"
            />
            {(fieldErrors.teamName || fieldErrors.name) && (
              <p className="text-xs text-red-400 mt-1">{fieldErrors.teamName || fieldErrors.name}</p>
            )}
          </div>

          <div>
            <label htmlFor="reg-display" className="block text-sm font-medium mb-1">
              Tu nombre de supervisor
            </label>
            <input
              id="reg-display"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="reg-email" className="block text-sm font-medium mb-1">
              Correo electrónico
            </label>
            <input
              id="reg-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-slate-100"
            />
            {fieldErrors.email && <p className="text-xs text-red-400 mt-1">{fieldErrors.email}</p>}
          </div>

          <div>
            <label htmlFor="reg-pass" className="block text-sm font-medium mb-1">
              Contraseña
            </label>
            <input
              id="reg-pass"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-slate-100"
            />
            {fieldErrors.password && <p className="text-xs text-red-400 mt-1">{fieldErrors.password}</p>}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 px-4 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold text-white"
          >
            {submitting ? 'Registrando…' : 'Crear cuadrilla e ingresar'}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-400 text-center">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-teal-400 underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
};
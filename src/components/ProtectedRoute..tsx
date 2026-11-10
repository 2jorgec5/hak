// src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: React.ReactNode;
  requiredPermission?: string;
}

export const ProtectedRoute: React.FC<Props> = ({ children, requiredPermission }) => {
  const { me, hasPermission } = useAuth();
  const location = useLocation();

  if (!me) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <h1 className="text-2xl font-bold text-amber-400 mb-2">Acceso Restringido (Sin permiso)</h1>
        <p className="text-slate-300 mb-6">
          Tu rol actual no cuenta con el permiso necesario ({requiredPermission}) para acceder a esta zona.
        </p>
        <Link to="/files" className="px-4 py-2 bg-teal-600 rounded text-white font-medium">
          Volver a Archivos
        </Link>
      </main>
    );
  }

  return <>{children}</>;
};
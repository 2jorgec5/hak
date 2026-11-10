// src/App.tsx
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { StatusPage } from './pages/StatusPage';

// Carga perezosa (lazy) para mantener el bundle inicial de /login menor a 180 KB gzip (CP6)
const RefineView = lazy(() => import('./features/mdr/RefineView').then(m => ({ default: m.RefineView })));

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Suspense
            fallback={
              <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center font-mono text-sm">
                Cargando módulo del piso separado…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Navigate to="/files" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/estado" element={<StatusPage />} />

              {/* Ruta principal del CP2: Listado de archivos */}
              <Route
                path="/files"
                element={
                  <ProtectedRoute requiredPermission="files:read">
                    <main className="min-h-screen bg-slate-950 text-slate-100 p-8 max-w-5xl mx-auto">
                      <div className="flex justify-between items-center mb-6">
                        <h1 className="text-2xl font-bold">Archivos de Datos — Macrodata Refinement</h1>
                        <Link to="/estado" className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm font-medium">
                          Ver Estado / Clearance
                        </Link>
                      </div>
                      <p className="text-slate-400 mb-4">
                        Selecciona un archivo de la lista o ingresa directamente a su consola de refinamiento por su ID.
                      </p>
                      <div className="bg-slate-900 border border-slate-800 rounded p-6">
                        {/* Aquí puedes listar los IDs de archivos de prueba (ej: /files/1/refine) */}
                        <p className="text-sm mb-2 text-slate-300">Prueba acceder directamente a una grilla:</p>
                        <Link
                          to="/files/1/refine"
                          className="inline-block px-4 py-2 bg-teal-600 hover:bg-teal-500 rounded text-white font-medium text-sm"
                        >
                          Abrir Consola del Archivo #1
                        </Link>
                      </div>
                    </main>
                  </ProtectedRoute>
                }
              />

              {/* Ruta principal de la Grilla Virtualizada del CP2 */}
              <Route
                path="/files/:id/refine"
                element={
                  <ProtectedRoute requiredPermission="files:refine">
                    <RefineView />
                  </ProtectedRoute>
                }
              />

              <Route
                path="*"
                element={
                  <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
                    <h1 className="text-3xl font-bold mb-2">404 — Zona Inexistente</h1>
                    <p className="text-slate-400 mb-6">Esta ruta no pertenece al piso separado de Lumon.</p>
                    <Link to="/files" className="px-4 py-2 bg-teal-600 rounded text-white font-medium text-sm">
                      Volver a Archivos
                    </Link>
                  </main>
                }
              />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
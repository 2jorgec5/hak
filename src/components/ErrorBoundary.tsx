// src/components/ErrorBoundary.tsx
import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
          <h1 className="text-2xl font-bold text-red-400 mb-2">Ocurrió un error en la consola</h1>
          <p className="text-slate-400 mb-6">{this.state.message}</p>
          <a
            href="/files"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-4 py-2 bg-teal-600 rounded text-white font-medium"
          >
            Volver al inicio
          </a>
        </main>
      );
    }
    return this.props.children;
  }
}
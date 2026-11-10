// src/features/incidents/IncidentCreateView.tsx
import React, { useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import { uploadWithProgress } from '../../features/media/mediaUpload';

interface PhotoSlot {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'confirmed' | 'error';
  progress: number;
  mediaId?: string;
  error?: string;
}

export const IncidentCreateView: React.FC = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slots, setSlots] = useState<PhotoSlot[]>([]);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [successReport, setSuccessReport] = useState(false);

  const handleFilesAdded = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (slots.length + files.length > 3) {
      alert('Solo se permiten entre 1 y 3 fotografías por incidencia.');
      return;
    }

    const newSlots: PhotoSlot[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'pending',
      progress: 0,
    }));

    setSlots((prev) => [...prev, ...newSlots]);
  };

  const uploadSinglePhoto = async (slotId: string) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, status: 'uploading', error: undefined } : s))
    );

    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;

    try {
      // 1. Pedir ticket para propósitos de incidencia (INCIDENT)
      const { data: ticket } = await apiFetch<{
        ticketId: string;
        uploadUrl: string;
        headers?: Record<string, string>;
      }>('/media/tickets', {
        method: 'POST',
        body: JSON.stringify({
          purpose: 'INCIDENT',
          bytes: slot.file.size,
          width: 1200, // Estimación o lectura de dimensiones
          height: 900,
          sha256: 'dummy_sha256_if_allowed_or_computed', // Puedes usar computeSha256Hex(slot.file) si lo prefieres
        }),
      });

      const headers = ticket.headers || {};
      if (!headers['Content-Type']) headers['Content-Type'] = slot.file.type;

      // 2. Subir con progreso XHR en paralelo
      const { promise } = uploadWithProgress(
        ticket.uploadUrl,
        'POST',
        headers,
        slot.file,
        (pct) => {
          setSlots((prev) =>
            prev.map((s) => (s.id === slotId ? { ...s, progress: pct } : s))
          );
        }
      );

      const rawResp = await promise;
      let finalUrl = ticket.uploadUrl;
      try {
        const parsed = JSON.parse(rawResp);
        if (parsed.secure_url) finalUrl = parsed.secure_url;
      } catch {
        // Directo
      }

      // 3. Confirmar la imagen
      const { data: confirmData } = await apiFetch<{ mediaId: string }>(
        `/media/tickets/${ticket.ticketId}/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ url: finalUrl }),
        }
      );

      setSlots((prev) =>
        prev.map((s) =>
          s.id === slotId ? { ...s, status: 'confirmed', mediaId: confirmData.mediaId, progress: 100 } : s
        )
      );
    } catch (err) {
      const errMsg = err instanceof ApiError ? err.body.message : 'Error al subir imagen';
      setSlots((prev) =>
        prev.map((s) => (s.id === slotId ? { ...s, status: 'error', error: errMsg } : s))
      );
    }
  };

  const handleUploadAll = async () => {
    const pendingSlots = slots.filter((s) => s.status === 'pending' || s.status === 'error');
    await Promise.all(pendingSlots.map((s) => uploadSinglePhoto(s.id)));
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const confirmedMediaIds = slots.filter((s) => s.status === 'confirmed' && s.mediaId).map((s) => s.mediaId!);

    if (confirmedMediaIds.length === 0) {
      setGeneralError('Debes subir y confirmar al menos una fotografía antes de enviar el reporte.');
      return;
    }

    setSubmittingReport(true);
    setGeneralError(null);

    try {
      await apiFetch('/incidents', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          mediaIds: confirmedMediaIds,
        }),
      });

      setSuccessReport(true);
      setTitle('');
      setDescription('');
      setSlots([]);
    } catch (err) {
      if (err instanceof ApiError) {
        setGeneralError(`Error al crear incidencia: ${err.body.message}`);
      } else {
        setGeneralError('Fallo de red al enviar el reporte.');
      }
    } finally {
      setSubmittingReport(false);
    }
  };

  const allConfirmed = slots.length > 0 && slots.every((s) => s.status === 'confirmed');

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Reportar Incidencia en el Piso Separado</h1>

      {generalError && (
        <div role="alert" className="p-3 bg-red-950 border border-red-800 text-red-200 text-sm rounded">
          {generalError}
        </div>
      )}

      {successReport && (
        <div role="alert" className="p-3 bg-teal-950 border border-teal-800 text-teal-200 text-sm rounded">
          ¡Incidencia reportada con éxito y registrada por Lumon!
        </div>
      )}

      <form onSubmit={handleSubmitReport} className="space-y-4 bg-slate-900 border border-slate-800 p-6 rounded-lg">
        <div>
          <label className="block text-sm font-medium mb-1">Título de la incidencia</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-100"
            placeholder="Ej. Anomalía en terminal de Macrodata"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Descripción</label>
          <textarea
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-slate-100"
            placeholder="Describe los hechos sin omitir detalles..."
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium">Evidencias Fotográficas (1 a 3 fotos)</label>
            {slots.length < 3 && (
              <label className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs cursor-pointer text-teal-400 font-medium">
                Añadir Fotos
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleFilesAdded} />
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {slots.map((slot) => (
              <div key={slot.id} className="bg-slate-950 border border-slate-800 rounded p-2 space-y-2 text-xs">
                <img src={slot.previewUrl} alt="Evidencia" className="w-full h-24 object-cover rounded" />
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-mono capitalize">{slot.status}</span>
                  {slot.status === 'error' && (
                    <button type="button" onClick={() => void uploadSinglePhoto(slot.id)} className="text-red-400 underline">
                      Reintentar
                    </button>
                  )}
                </div>
                {slot.status === 'uploading' && (
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-teal-500 h-1.5 transition-all" style={{ width: `${slot.progress}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {slots.length > 0 && !allConfirmed && (
            <button
              type="button"
              onClick={() => void handleUploadAll()}
              className="mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-medium"
            >
              Confirmar y Subir Fotos Pendientes al Storage
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={!allConfirmed || submittingReport}
          className="w-full py-2.5 px-4 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold text-white text-sm"
        >
          {submittingReport ? 'Enviando Reporte…' : 'Enviar Reporte de Incidencia'}
        </button>
      </form>
    </main>
  );
};
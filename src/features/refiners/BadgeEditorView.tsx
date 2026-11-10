// src/features/refiners/BadgeEditorView.tsx
import React, { useState, useRef } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import { renderCropToWebp, uploadWithProgress } from '../../features/media/mediaUpload';

interface Props {
  refinerId: number | string;
  currentName: string;
  onBadgeUpdated: (newMediaId: string) => void;
}

export const BadgeEditorView: React.FC<Props> = ({ refinerId, currentName, onBadgeUpdated }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('El archivo seleccionado debe ser una imagen.');
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleProcessAndUpload = async () => {
    if (!previewUrl || !selectedFile) return;
    setSubmitting(true);
    setProgress(0);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Cargar imagen en memoria
      const img = new Image();
      img.src = previewUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // 2. Renderizar estrictamente a WebP 512x512 y < 120 KB (Regla BADGE de Lumon) limpiando EXIF
      const processed = await renderCropToWebp(
        img,
        { sx: 0, sy: 0, sw: img.width, sh: img.height },
        512,
        512,
        120 * 1024
      );

      // 3. Solicitar ticket de subida al backend
      const { data: ticket } = await apiFetch<{
        ticketId: string;
        uploadUrl: string;
        headers?: Record<string, string>;
      }>('/media/tickets', {
        method: 'POST',
        body: JSON.stringify({
          purpose: 'BADGE',
          bytes: processed.bytes,
          width: processed.width,
          height: processed.height,
          sha256: processed.sha256,
        }),
      });

      // 4. Subir directamente al storage configurado (Cloudinary / Supabase) con progreso XHR
      const headers = ticket.headers || {};
      if (!headers['Content-Type']) headers['Content-Type'] = 'image/webp';

      const { promise } = uploadWithProgress(
        ticket.uploadUrl,
        'POST',
        headers,
        processed.blob,
        (pct) => setProgress(pct)
      );

      const rawResp = await promise;
      let finalUrl = ticket.uploadUrl;
      try {
        const parsed = JSON.parse(rawResp);
        if (parsed.secure_url) finalUrl = parsed.secure_url;
      } catch {
        // Formato directo
      }

      // 5. Confirmar subida al backend para obtener el mediaId
      const { data: confirmData } = await apiFetch<{ mediaId: string }>(
        `/media/tickets/${ticket.ticketId}/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ url: finalUrl }),
        }
      );

      // 6. Actualizar el expediente del refinador respetando la Regla de Milchick (ETag / If-Match)
      // Nota: Si usas If-Match: * según errata o el ETag obtenido por GET /refiners/{id}
      await apiFetch(`/refiners/${refinerId}`, {
        method: 'PATCH',
        headers: {
          'If-Match': '*', 
        },
        body: JSON.stringify({
          badgeMediaId: confirmData.mediaId,
        }),
      });

      setSuccessMsg('¡Fotocheck actualizado con éxito en el piso separado!');
      onBadgeUpdated(confirmData.mediaId);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(`Error (${err.body.error}): ${err.body.message}`);
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Ocurrió un error inesperado al procesar la imagen.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 max-w-lg mx-auto space-y-6 text-slate-100">
      <div>
        <h1 className="text-xl font-bold">Editor de Fotocheck</h1>
        <p className="text-sm text-slate-400">Refinador: {currentName} (ID: {refinerId})</p>
      </div>

      {errorMsg && (
        <div role="alert" className="p-3 bg-red-950 border border-red-800 text-red-200 text-sm rounded">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div role="alert" className="p-3 bg-teal-950 border border-teal-800 text-teal-200 text-sm rounded">
          {successMsg}
        </div>
      )}

      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-slate-700 hover:border-teal-500 rounded-lg p-8 text-center cursor-pointer flex flex-col items-center justify-center bg-slate-950 transition-colors"
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Vista previa" className="w-40 h-40 object-cover rounded-md mb-2 border border-slate-700 shadow" />
        ) : (
          <>
            <p className="text-sm font-medium text-slate-300">Haz clic aquí o arrastra la nueva foto</p>
            <p className="text-xs text-slate-500 mt-1">Formato WebP / PNG / JPG (Se convertirá a WebP 512x512)</p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {submitting && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-slate-400 font-mono">
            <span>Subiendo fotocheck al storage de Lumon…</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="bg-teal-500 h-2 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!selectedFile || submitting}
        onClick={() => void handleProcessAndUpload()}
        className="w-full py-2.5 px-4 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold text-white text-sm transition-colors shadow"
      >
        {submitting ? 'Procesando y Subiendo…' : 'Guardar y Actualizar Fotocheck'}
      </button>
    </div>
  );
};
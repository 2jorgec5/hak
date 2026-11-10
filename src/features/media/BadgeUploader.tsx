// src/features/media/BadgeUploader.tsx
import React, { useState, useRef } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import { renderCropToWebp, uploadWithProgress } from './mediaUpload';

interface Props {
  refinerId: number | string;
  onSuccess: (mediaId: string) => void;
}

export const BadgeUploader: React.FC<Props> = ({ refinerId, onSuccess }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Por favor selecciona un archivo de imagen válido.');
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setErrorMsg(null);
  };

  const handleUploadProcess = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setProgress(0);
    setErrorMsg(null);

    try {
      // 1. Cargar la imagen en memoria para procesarla
      const img = new Image();
      img.src = previewUrl!;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });

      // 2. Renderizar a WebP exacto 512x512 y < 120 KB (Regla BADGE) sin metadatos
      const processed = await renderCropToWebp(
        img,
        { sx: 0, sy: 0, sw: img.width, sh: img.height },
        512,
        512,
        120 * 1024
      );

      // 3. Pedir ticket de subida al backend de Lumon
      const { data: ticket } = await apiFetch<{
        ticketId: string;
        uploadUrl: string;
        path: string;
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

      // 4. Subir directo al Storage (Cloudinary / Supabase) con progreso XHR
      const uploadHeaders = ticket.headers || {};
      if (!uploadHeaders['Content-Type']) {
        uploadHeaders['Content-Type'] = 'image/webp';
      }

      const { promise } = uploadWithProgress(
        ticket.uploadUrl,
        'POST',
        uploadHeaders,
        processed.blob,
        (pct) => setProgress(pct)
      );

      const rawResponse = await promise;
      let finalPublicUrl = ticket.uploadUrl;
      
      // Si usas Cloudinary en modo unsigned, parseamos la respuesta para obtener la URL segura
      try {
        const cloudRes = JSON.parse(rawResponse);
        if (cloudRes.secure_url) finalPublicUrl = cloudRes.secure_url;
      } catch {
        // Si es Supabase u otro formato directo
      }

      // 5. Confirmar la subida del media al backend
      const { data: confirmData } = await apiFetch<{ mediaId: string }>(
        `/media/tickets/${ticket.ticketId}/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ url: finalPublicUrl }),
        }
      );

      onSuccess(confirmData.mediaId);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(`Error de verificación (${err.body.error}): ${err.body.message}`);
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Error desconocido al procesar o subir la imagen.');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 max-w-md space-y-4">
      <h2 className="text-lg font-bold text-slate-100">Actualizar Fotocheck (Refinador #{refinerId})</h2>

      {errorMsg && (
        <div role="alert" className="p-3 bg-red-950 border border-red-800 text-red-200 text-sm rounded">
          {errorMsg}
        </div>
      )}

      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-slate-700 hover:border-teal-500 rounded-lg p-6 text-center cursor-pointer flex flex-col items-center justify-center bg-slate-950"
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Vista previa" className="w-32 h-32 object-cover rounded mb-2 border border-slate-700" />
        ) : (
          <p className="text-sm text-slate-400">Haz clic o arrastra una imagen aquí (JPEG, PNG)</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {uploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Subiendo a Lumon Storage…</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="bg-teal-500 h-2 transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!selectedFile || uploading}
        onClick={() => void handleUploadProcess()}
        className="w-full py-2 px-4 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 font-semibold text-white text-sm"
      >
        {uploading ? 'Procesando WebP y Subiendo…' : 'Confirmar y Actualizar Fotocheck'}
      </button>
    </div>
  );
};
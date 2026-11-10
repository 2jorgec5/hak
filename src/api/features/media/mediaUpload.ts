// src/features/media/mediaUpload.ts
export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

export async function computeSha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function renderCropToWebp(
  image: HTMLImageElement,
  crop: { sx: number; sy: number; sw: number; sh: number },
  targetWidth: number,
  targetHeight: number,
  maxBytes: number
): Promise<ProcessedImage> {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo inicializar el contexto 2D del canvas');

  ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, targetWidth, targetHeight);

  // Probamos calidades decrecientes hasta cumplir el peso máximo (120 KB BADGE / 300 KB INCIDENT)
  const qualities = [0.9, 0.8, 0.7, 0.6, 0.5];
  for (const q of qualities) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/webp', q)
    );
    if (!blob || blob.type !== 'image/webp') {
      throw new Error('Este navegador no soporta codificación a image/webp.');
    }
    if (blob.size <= maxBytes) {
      const sha256 = await computeSha256Hex(blob);
      return {
        blob,
        width: targetWidth,
        height: targetHeight,
        bytes: blob.size,
        sha256,
      };
    }
  }
  throw new Error(`La imagen supera el límite de ${Math.round(maxBytes / 1024)} KB incluso comprimida.`);
}

export function uploadWithProgress(
  uploadUrl: string,
  method: 'POST' | 'PUT',
  headers: Record<string, string>,
  body: Blob | FormData,
  onProgress: (percent: number) => void
): { promise: Promise<string>; abort: () => void } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<string>((resolve, reject) => {
    xhr.open(method, uploadUrl, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`Error en subida al storage (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Fallo de red durante la subida de imagen.'));
    xhr.onabort = () => reject(new Error('Subida cancelada por el usuario.'));
    xhr.send(body);
  });

  return { promise, abort: () => xhr.abort() };
}
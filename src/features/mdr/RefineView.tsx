// src/features/mdr/RefineView.tsx
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../api/client';
import { TileStore, DecodedTile, FileRules, BinCode } from './gridEngine';

interface FileDetail {
  id: number;
  name: string;
  rows: number;
  cols: number;
  tileSize: number;
  status: string;
}

export const RefineView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [fileDetail, setFileDetail] = useState<FileDetail | null>(null);
  const [rules, setRules] = useState<FileRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estado del TileStore y grilla
  const [store, setStore] = useState<TileStore | null>(null);
  const [visibleTiles, setVisibleTiles] = useState<Set<string>>(new Set());
  const [renderTick, setRenderTick] = useState(0);

  // Selección activa de grupo
  const [selectedGroup, setSelectedGroup] = useState<{
    cells: Array<{ r: number; c: number; digit: number }>;
    targetBin: BinCode | null;
    isNoise: boolean;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Posición inicial de scroll desde la URL (?r=&c=)
  const initialR = Number(searchParams.get('r') || '0');
  const initialC = Number(searchParams.get('c') || '0');

  // 1. Cargar metadatos y reglas del archivo
  useEffect(() => {
    if (!id) return;
    let mounted = true;

    async function loadData() {
      try {
        const [fileRes, rulesRes] = await Promise.all([
          apiFetch<FileDetail>(`/files/${id}`),
          apiFetch<FileRules>(`/files/${id}/rules`),
        ]);

        if (!mounted) return;
        setFileDetail(fileRes.data);
        setRules(rulesRes.data);

        const tileStore = new TileStore(
          id,
          fileRes.data.tileSize,
          fileRes.data.rows,
          fileRes.data.cols
        );
        setStore(tileStore);
      } catch (err) {
        if (!mounted) return;
        if (err instanceof ApiError) {
          setErrorMsg(`Error ${err.body.error}: ${err.body.message}`);
        } else {
          setErrorMsg('No se pudo cargar el archivo de datos.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadData();
    return () => {
      mounted = false;
    };
  }, [id]);

  // 2. Control de celdas visibles y carga de tiles en viewport
  const handleScroll = useCallback(() => {
    if (!containerRef.current || !fileDetail || !store) return;
    const el = containerRef.current;
    const scrollTop = el.scrollTop;
    const scrollLeft = el.scrollLeft;
    const clientHeight = el.clientHeight;
    const clientWidth = el.clientWidth;

    const tileSize = fileDetail.tileSize;
    const startRowTile = Math.floor(scrollTop / (tileSize * 16)); // ~16px por celda estimada
    const endRowTile = Math.floor((scrollTop + clientHeight) / (tileSize * 16)) + 1;
    const startColTile = Math.floor(scrollLeft / (tileSize * 16));
    const endColTile = Math.floor((scrollLeft + clientWidth) / (tileSize * 16)) + 1;

    const newVisibleKeys = new Set<string>();
    const totalRowTiles = Math.ceil(fileDetail.rows / tileSize);
    const totalColTiles = Math.ceil(fileDetail.cols / tileSize);

    for (let tr = Math.max(0, startRowTile - 1); tr <= Math.min(totalRowTiles - 1, endRowTile + 1); tr++) {
      for (let tc = Math.max(0, startColTile - 1); tc <= Math.min(totalColTiles - 1, endColTile + 1); tc++) {
        const k = `${tr}:${tc}`;
        newVisibleKeys.add(k);
        void store.ensureTile(tr, tc).then(() => {
          setRenderTick((t) => t + 1);
        });
      }
    }

    store.cancelOutOfView(newVisibleKeys);
    setVisibleTiles(newVisibleKeys);
  }, [fileDetail, store]);

  useEffect(() => {
    if (fileDetail && store) {
      handleScroll();
    }
  }, [fileDetail, store, handleScroll]);

  // 3. Click en una celda para calcular el grupo completo (BFS)
  const handleCellClick = async (r: number, c: number) => {
    if (!store || !rules) return;
    try {
      const group = await store.findConnectedGroup(r, c, rules);
      setSelectedGroup(group);
    } catch {
      // Manejar error de carga de tile en BFS
    }
  };

  // 4. Refinar grupo hacia la caja seleccionada
  const handleRefineSubmit = async (targetBin: BinCode) => {
    if (!selectedGroup || selectedGroup.isNoise || !id || !store) return;
    try {
      const idempotencyKey = crypto.randomUUID();
      const cellsPayload = selectedGroup.cells.map((cell) => ({ r: cell.r, c: cell.c }));

      await apiFetch(`/files/${id}/refinements`, {
        method: 'POST',
        headers: {
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          bin: targetBin,
          cells: cellsPayload,
        }),
      });

      // Actualizar estado local del tile store
      store.markCellsRefined(cellsPayload, targetBin);
      setSelectedGroup(null);
      setRenderTick((t) => t + 1);
    } catch (err) {
      if (err instanceof ApiError) {
        alert(`Error al refinar (${err.body.error}): ${err.body.message}`);
      } else {
        alert('Fallo de red al enviar refinamiento.');
      }
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-100 p-8">Cargando archivo de Macrodata…</div>;
  }

  if (errorMsg || !fileDetail || !rules || !store) {
    return (
      <div className="min-h-screen bg-slate-950 text-red-400 p-8">
        <h1 className="text-xl font-bold mb-2">Error en el Archivo</h1>
        <p>{errorMsg}</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
        <h1 className="font-bold">Archivo #{fileDetail.id} — {fileDetail.name}</h1>
        <div className="text-sm text-slate-400">
          Dimensiones: {fileDetail.rows} × {fileDetail.cols} | Umbral: {rules.tremorThreshold}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Grilla virtualizada con scroll */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto p-4 relative bg-slate-950 flex items-center justify-center"
          style={{ height: 'calc(100vh - 70px)' }}
        >
          <div
            className="grid bg-slate-900 border border-slate-800 relative"
            style={{
              gridTemplateColumns: `repeat(${fileDetail.cols}, minmax(20px, 1fr))`,
              width: `${fileDetail.cols * 24}px`,
            }}
          >
            {/* Renderizamos las celdas de los tiles cargados */}
            {Array.from({ length: fileDetail.rows }).map((_, r) =>
              Array.from({ length: fileDetail.cols }).map((_, c) => {
                const tr = Math.floor(r / fileDetail.tileSize);
                const tc = Math.floor(c / fileDetail.tileSize);
                const tile = store.getCachedTile(tr, tc);

                if (!tile) {
                  return <div key={`${r}-${c}`} className="w-6 h-6 bg-slate-900/50 border border-slate-900" />;
                }

                const localR = r - tile.originRow;
                const localC = c - tile.originCol;
                const idx = localR * tile.cols + localC;

                const digit = tile.values[idx] || '0';
                const tremor = tile.tremorBytes[idx] || 0;
                const binState = tile.binsArray[idx] || '.';
                const isScared = tremor >= rules.tremorThreshold;

                let bgClass = 'bg-slate-950 text-slate-400';
                if (binState === 'W') bgClass = 'bg-amber-900/60 text-amber-200';
                else if (binState === 'F') bgClass = 'bg-blue-900/60 text-blue-200';
                else if (binState === 'D') bgClass = 'bg-purple-900/60 text-purple-200';
                else if (binState === 'M') bgClass = 'bg-red-900/60 text-red-200';
                else if (isScared) bgClass = 'bg-teal-950 text-teal-300 font-bold';

                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    onClick={() => void handleCellClick(r, c)}
                    className={`w-6 h-6 text-xs flex items-center justify-center border border-slate-900/40 select-none ${bgClass} ${
                      isScared && binState === '.' ? 'animate-pulse' : ''
                    }`}
                    title={`R:${r} C:${c} | Tremor:${tremor}`}
                  >
                    {digit}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Panel lateral de Refinamiento y Cajas */}
        <aside className="w-80 bg-slate-900 border-l border-slate-800 p-4 flex flex-col justify-between">
          <div>
            <h2 className="font-bold text-lg mb-4">Consola de Refinamiento</h2>
            {selectedGroup ? (
              <div className="space-y-4">
                <div className="p-3 bg-slate-950 rounded border border-slate-800 text-sm space-y-1">
                  <p><strong>Tamaño del grupo:</strong> {selectedGroup.cells.length} celdas</p>
                  <p><strong>¿Es ruido?:</strong> {selectedGroup.isNoise ? 'Sí (fuera de rango)' : 'No'}</p>
                  <p><strong>Caja destino:</strong> <span className="text-teal-400 font-bold">{selectedGroup.targetBin || 'N/A'}</span></p>
                </div>

                {!selectedGroup.isNoise && selectedGroup.targetBin && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400">Llevar grupo a la caja:</p>
                    <button
                      type="button"
                      onClick={() => void handleRefineSubmit(selectedGroup.targetBin!)}
                      className="w-full py-2 bg-teal-600 hover:bg-teal-500 rounded font-semibold text-white"
                    >
                       Depositar en {selectedGroup.targetBin}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Selecciona una celda que dé miedo en la grilla para inspeccionar su grupo conexo.
              </p>
            )}
          </div>

          <div className="text-xs text-slate-500 text-center">
            Lumon Industries — Floor 4
          </div>
        </aside>
      </div>
    </main>
  );
};
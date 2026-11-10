// src/features/mdr/useFloorWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../api/client';

const WS_BASE = import.meta.env.VITE_WS_BASE_URL as string;

export interface Member {
  userId: string | number;
  displayName: string;
}

export interface Claim {
  claimId: string;
  userId: string | number;
  cells: Array<{ r: number; c: number }>;
  expiresAt: string;
}

export function useFloorWebSocket(fileId: string | number | undefined) {
  const [status, setStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const [members, setMembers] = useState<Member[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [cursors, setCursors] = useState<Record<string, { r: number; c: number }>>({});
  
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<number | null>(null);

  const sendJson = useCallback((payload: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // Acciones expuestas al componente de la grilla
  const sendCursor = useCallback((r: number, c: number) => {
    sendJson({ type: 'cursor', r, c });
  }, [sendJson]);

  const sendClaim = useCallback((requestId: string, r: number, c: number) => {
    sendJson({ type: 'claim', requestId, r, c });
  }, [sendJson]);

  const sendRelease = useCallback((claimId: string) => {
    sendJson({ type: 'release', claimId });
  }, [sendJson]);

  useEffect(() => {
    if (!fileId) return;
    let active = true;
    let reconnectTimer: number | undefined;

    const connectWs = async () => {
      if (!active) return;
      try {
        setStatus('reconnecting');
        // 1. Pedir ticket de WebSocket para el archivo
        const { data } = await apiFetch<{ ticket: string }>('/floor/tickets', {
          method: 'POST',
          body: JSON.stringify({ fileId: Number(fileId) }),
        });

        if (!active) return;

        const wsUrl = `${WS_BASE}/floor/ws?ticket=${data.ticket}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setStatus('connected');
          // Iniciar ping cada 15-20 segundos
          pingIntervalRef.current = window.setInterval(() => {
            sendJson({ type: 'ping', t: Date.now() });
          }, 15000);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as {
              type: string;
              seq?: number;
              members?: Member[];
              claims?: Claim[];
              userId?: string | number;
              displayName?: string;
              r?: number;
              c?: number;
              requestId?: string;
              claimId?: string;
              cells?: Array<{ r: number; c: number }>;
              expiresAt?: string;
            };

            switch (msg.type) {
              case 'snapshot':
                if (msg.members) setMembers(msg.members);
                if (msg.claims) setClaims(msg.claims);
                break;
              case 'member.joined':
                if (msg.userId && msg.displayName) {
                  setMembers((prev) => [...prev.filter(m => m.userId !== msg.userId), { userId: msg.userId!, displayName: msg.displayName! }]);
                }
                break;
              case 'member.left':
                if (msg.userId) {
                  setMembers((prev) => prev.filter(m => m.userId !== msg.userId));
                }
                break;
              case 'cursor':
                if (msg.userId && msg.r !== undefined && msg.c !== undefined) {
                  setCursors((prev) => ({ ...prev, [msg.userId!]: { r: msg.r!, c: msg.c! } }));
                }
                break;
              case 'claim.granted':
              case 'claim.updated':
                if (msg.claimId && msg.cells && msg.userId && msg.expiresAt) {
                  setClaims((prev) => [
                    ...prev.filter(c => c.claimId !== msg.claimId),
                    { claimId: msg.claimId!, userId: msg.userId!, cells: msg.cells!, expiresAt: msg.expiresAt! }
                  ]);
                }
                break;
              case 'claim.released':
                if (msg.claimId) {
                  setClaims((prev) => prev.filter(c => c.claimId !== msg.claimId));
                }
                break;
              default:
                break;
            }
          } catch {
            // Error al parsear mensaje JSON del WebSocket
          }
        };

        ws.onclose = (evt) => {
          if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
          setStatus('disconnected');

          // Códigos definitivos que no deben reconectar según el enunciado
          const fatalCodes = [4400, 4403, 4404, 4423];
          if (fatalCodes.includes(evt.code)) return;

          if (active) {
            reconnectTimer = window.setTimeout(connectWs, 3000);
          }
        };
      } catch {
        if (active) {
          reconnectTimer = window.setTimeout(connectWs, 5000);
        }
      }
    };

    void connectWs();

    return () => {
      active = false;
      if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
      window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      setStatus('disconnected');
    };
  }, [fileId, sendJson]);

  return { status, members, claims, cursors, sendCursor, sendClaim, sendRelease };
}
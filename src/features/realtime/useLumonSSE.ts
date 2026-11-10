// src/features/realtime/useLumonSSE.ts
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';

export type SSEEventType =
  | 'refiner.updated'
  | 'refinement.created'
  | 'file.completed'
  | 'contingency.activated'
  | 'session.revoked'
  | 'stream.reset'
  | 'stream.superseded';

export interface LumonEvent {
  id: string;
  type: SSEEventType;
  payload: unknown;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const LAST_ID_KEY = 'lumon_last_event_id';

export function useLumonSSE(onEvent: (ev: LumonEvent) => void) {
  const [status, setStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;
    let retryTimeout: number | undefined;
    let attempt = 0;
    const processedIds = new Set<string>();

    const connect = async () => {
      if (!active) return;
      try {
        setStatus('reconnecting');
        // 1. Pedir ticket de 30 segundos para el stream de eventos
        const { data } = await apiFetch<{ ticket: string }>('/events/tickets', { method: 'POST' });
        if (!active) return;

        const lastEventId = localStorage.getItem(LAST_ID_KEY);
        const url = new URL(`${API_BASE}/events/stream`);
        url.searchParams.set('ticket', data.ticket);
        if (lastEventId) url.searchParams.set('lastEventId', lastEventId);

        eventSource = new EventSource(url.toString());

        eventSource.onopen = () => {
          attempt = 0;
          setStatus('connected');
        };

        const eventTypes: SSEEventType[] = [
          'refiner.updated',
          'refinement.created',
          'file.completed',
          'contingency.activated',
          'session.revoked',
          'stream.reset',
          'stream.superseded',
        ];

        eventTypes.forEach((type) => {
          eventSource?.addEventListener(type, (rawEv: MessageEvent) => {
            const eventId = rawEv.lastEventId;
            if (eventId && processedIds.has(eventId)) return; // Evitar duplicados
            if (eventId) {
              processedIds.add(eventId);
              localStorage.setItem(LAST_ID_KEY, eventId);
            }

            const payload = rawEv.data ? JSON.parse(rawEv.data) : null;
            callbackRef.current({ id: eventId, type, payload });

            if (type === 'stream.reset' || type === 'stream.superseded') {
              eventSource?.close();
            }
          });
        });

        eventSource.onerror = () => {
          eventSource?.close();
          if (!active) return;
          setStatus('reconnecting');
          const backoff = Math.min(15000, 1000 * Math.pow(2, attempt) + Math.random() * 300);
          attempt++;
          retryTimeout = window.setTimeout(connect, backoff);
        };
      } catch {
        if (!active) return;
        setStatus('reconnecting');
        const backoff = Math.min(15000, 1000 * Math.pow(2, attempt) + Math.random() * 300);
        attempt++;
        retryTimeout = window.setTimeout(connect, backoff);
      }
    };

    void connect();

    return () => {
      active = false;
      window.clearTimeout(retryTimeout);
      eventSource?.close();
      setStatus('disconnected');
    };
  }, []);

  return { status };
}
// src/features/realtime/sseLeader.ts
import { apiFetch } from '../../api/client';

export interface LumonRealtimeEvent {
  id: string;
  type:
    | 'refiner.updated'
    | 'refinement.created'
    | 'file.completed'
    | 'contingency.activated'
    | 'session.revoked'
    | 'stream.reset'
    | 'stream.superseded';
  payload: unknown;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const LAST_EVENT_ID_KEY = 'lumon_last_event_id';

export class SseCoordinator {
  private channel = new BroadcastChannel('lumon_sse_channel');
  private processedIds = new Set<string>();
  private listeners = new Set<(ev: LumonRealtimeEvent) => void>();
  private statusListeners = new Set<(status: 'connected' | 'reconnecting' | 'disconnected') => void>();
  private stopped = false;

  constructor() {
    this.channel.onmessage = (msg: MessageEvent<LumonRealtimeEvent | { __status: 'connected' | 'reconnecting' | 'disconnected' }>) => {
      if ('__status' in msg.data) {
        this.statusListeners.forEach((cb) => cb(msg.data.__status));
        return;
      }
      this.dispatchEvent(msg.data);
    };
  }

  onEvent(cb: (ev: LumonRealtimeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStatusChange(cb: (status: 'connected' | 'reconnecting' | 'disconnected') => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private notifyStatus(status: 'connected' | 'reconnecting' | 'disconnected'): void {
    this.statusListeners.forEach((cb) => cb(status));
    this.channel.postMessage({ __status: status });
  }

  private dispatchEvent(ev: LumonRealtimeEvent): void {
    if (ev.id && this.processedIds.has(ev.id)) return; // Deduplicación
    if (ev.id) {
      this.processedIds.add(ev.id);
      localStorage.setItem(LAST_EVENT_ID_KEY, ev.id);
    }
    this.listeners.forEach((cb) => cb(ev));
  }

  start(): void {
    this.stopped = false;
    if ('locks' in navigator) {
      // Solo una pestaña adquiere el lock; las demás esperan en cola automáticamente
      navigator.locks.request('lumon_sse_leader_lock', async () => {
        await this.runLeaderLoop();
      });
    } else {
      void this.runLeaderLoop();
    }
  }

  stop(): void {
    this.stopped = true;
    this.notifyStatus('disconnected');
  }

  private async runLeaderLoop(): Promise<void> {
    let attempt = 0;

    while (!this.stopped) {
      try {
        this.notifyStatus(attempt === 0 ? 'connected' : 'reconnecting');
        const { data } = await apiFetch<{ ticket: string }>('/events/tickets', { method: 'POST' });
        await this.openEventSource(data.ticket, () => {
          attempt = 0;
        });
      } catch {
        // Error al obtener ticket o caída de red
      }

      if (this.stopped) break;
      this.notifyStatus('reconnecting');
      const backoff = Math.min(15000, 1000 * Math.pow(2, attempt) + Math.random() * 400);
      attempt++;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  private openEventSource(ticket: string, onConnected: () => void): Promise<void> {
    return new Promise((resolve) => {
      const lastEventId = localStorage.getItem(LAST_EVENT_ID_KEY);
      const url = new URL(`${API_BASE}/events/stream`);
      url.searchParams.set('ticket', ticket);
      if (lastEventId) url.searchParams.set('lastEventId', lastEventId);

      const es = new EventSource(url.toString());
      let watchdogTimer: number | undefined;

      const resetWatchdog = () => {
        window.clearTimeout(watchdogTimer);
        // Detección de conexión muerta a los 45 segundos sin eventos
        watchdogTimer = window.setTimeout(() => {
          es.close();
          resolve();
        }, 45000);
      };

      es.onopen = () => {
        onConnected();
        this.notifyStatus('connected');
        resetWatchdog();
      };

      const eventTypes: LumonRealtimeEvent['type'][] = [
        'refiner.updated',
        'refinement.created',
        'file.completed',
        'contingency.activated',
        'session.revoked',
        'stream.reset',
        'stream.superseded',
      ];

      eventTypes.forEach((type) => {
        es.addEventListener(type, (rawEv: MessageEvent) => {
          resetWatchdog();
          const parsedPayload = rawEv.data ? JSON.parse(rawEv.data) : null;
          const item: LumonRealtimeEvent = {
            id: rawEv.lastEventId,
            type,
            payload: parsedPayload,
          };
          this.dispatchEvent(item);
          this.channel.postMessage(item);

          if (type === 'stream.superseded') {
            es.close();
            resolve();
          }
        });
      });

      es.onmessage = () => resetWatchdog();

      es.onerror = () => {
        window.clearTimeout(watchdogTimer);
        es.close();
        resolve();
      };
    });
  }
}
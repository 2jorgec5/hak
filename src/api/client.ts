// src/api/client.ts
export interface ApiErrorBody {
  error: string;
  message: string;
  details: unknown;
  timestamp: string;
  path: string;
  requestId: string;
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  headers: Headers;

  constructor(status: number, body: ApiErrorBody, headers: Headers) {
    super(body.message || body.error);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;
const REFRESH_KEY = 'lumon_rt';

// Access token VIVE SOLO EN MEMORIA
let accessToken: string | null = null;
let inTabRefreshPromise: Promise<string | null> | null = null;
let globalRateLimitUntil = 0;

type AuthChannelMessage =
  | { type: 'TOKEN_UPDATED'; accessToken: string; refreshToken: string }
  | { type: 'LOGOUT'; reason?: string };

const authChannel = new BroadcastChannel('lumon_auth_channel');
const authListeners = new Set<(reason?: string) => void>();

authChannel.onmessage = (event: MessageEvent<AuthChannelMessage>) => {
  const data = event.data;
  if (data.type === 'TOKEN_UPDATED') {
    accessToken = data.accessToken;
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
  } else if (data.type === 'LOGOUT') {
    accessToken = null;
    localStorage.removeItem(REFRESH_KEY);
    authListeners.forEach((cb) => cb(data.reason));
  }
};

export function onSessionTerminated(cb: (reason?: string) => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

export function setSessionTokens(access: string, refresh: string): void {
  accessToken = access;
  localStorage.setItem(REFRESH_KEY, refresh);
  authChannel.postMessage({
    type: 'TOKEN_UPDATED',
    accessToken: access,
    refreshToken: refresh,
  } satisfies AuthChannelMessage);
}

export function clearSessionTokens(reason?: string): void {
  accessToken = null;
  localStorage.removeItem(REFRESH_KEY);
  authChannel.postMessage({ type: 'LOGOUT', reason } satisfies AuthChannelMessage);
  authListeners.forEach((cb) => cb(reason));
}

export function getAccessToken(): string | null {
  return accessToken;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function refreshAccessToken(): Promise<string | null> {
  if (inTabRefreshPromise) return inTabRefreshPromise;

  const runRefresh = async (): Promise<string | null> => {
    const tokenBeforeLock = accessToken;

    if ('locks' in navigator) {
      return navigator.locks.request('lumon_refresh_lock', async () => {
        // Si otra pestaña ya rotó el token mientras esperábamos el lock, usamos el nuevo
        if (accessToken && accessToken !== tokenBeforeLock) {
          return accessToken;
        }
        return executeRefreshCall();
      });
    }
    return executeRefreshCall();
  };

  inTabRefreshPromise = runRefresh().finally(() => {
    inTabRefreshPromise = null;
  });

  return inTabRefreshPromise;
}

async function executeRefreshCall(): Promise<string | null> {
  const rt = localStorage.getItem(REFRESH_KEY);
  if (!rt) return null;

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lumon-Build': __LUMON_BUILD__,
    },
    body: JSON.stringify({ refreshToken: rt }),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({ error: 'UNKNOWN' }))) as ApiErrorBody;
    clearSessionTokens(errBody.error);
    return null;
  }

  const data = (await res.json()) as { accessToken: string; refreshToken: string };
  setSessionTokens(data.accessToken, data.refreshToken);
  return data.accessToken;
}

export interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
  attempt = 0,
  retriedAuth = false
): Promise<{ data: T; headers: Headers }> {
  // Respetar bloqueo por 429 Retry-After
  const now = Date.now();
  if (globalRateLimitUntil > now) {
    await sleep(globalRateLimitUntil - now);
  }

  const headers = new Headers(options.headers);
  headers.set('X-Lumon-Build', __LUMON_BUILD__);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!options.skipAuth && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Manejo de 429 Too Many Requests con Retry-After
  if (response.status === 429) {
    const retryAfterSec = Number(response.headers.get('Retry-After') || '2');
    const waitMs = Math.max(1000, retryAfterSec * 1000);
    globalRateLimitUntil = Date.now() + waitMs;
    await sleep(waitMs);
    return apiFetch<T>(path, options, attempt, retriedAuth);
  }

  // Manejo de 503 Service Unavailable con espera creciente y Retry-After
  if (response.status === 503 && attempt < 4) {
    const retryAfterHeader = response.headers.get('Retry-After');
    const waitMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : Math.min(8000, 500 * Math.pow(2, attempt) + Math.random() * 200);
    await sleep(waitMs);
    return apiFetch<T>(path, options, attempt + 1, retriedAuth);
  }

  if (response.status === 401 && !options.skipAuth) {
    const errBody = (await response.json().catch(() => ({
      error: 'TOKEN_INVALID',
      message: 'No autorizado',
    }))) as ApiErrorBody;

    // Solo TOKEN_EXPIRED justifica intentar un refresh una única vez
    if (errBody.error === 'TOKEN_EXPIRED' && !retriedAuth) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        return apiFetch<T>(path, options, attempt, true);
      }
    }

    if (
      errBody.error === 'REFRESH_REUSED' ||
      errBody.error === 'SESSION_REVOKED' ||
      errBody.error === 'TOKEN_INVALID'
    ) {
      clearSessionTokens(errBody.error);
    }
    throw new ApiError(response.status, errBody, response.headers);
  }

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({
      error: 'HTTP_ERROR',
      message: response.statusText,
    }))) as ApiErrorBody;
    throw new ApiError(response.status, errBody, response.headers);
  }

  if (response.status === 204) {
    return { data: undefined as T, headers: response.headers };
  }

  const data = (await response.json()) as T;
  return { data, headers: response.headers };
}
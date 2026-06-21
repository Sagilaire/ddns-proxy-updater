// Thin fetch wrapper. We don't depend on axios to keep the bundle small.

const BASE_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

const TOKEN_KEY = 'ddns.token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  json?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  _noAuth?: boolean;
};

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const token = opts._noAuth ? '' : getToken();
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  };
  if (opts.signal) init.signal = opts.signal;
  if (opts.json !== undefined) init.body = JSON.stringify(opts.json);

  const res = await fetch(url, init);
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (res.status === 401 && !opts._noAuth) {
    setToken('');
    window.dispatchEvent(new CustomEvent('ddns:unauthorized'));
  }
  if (!res.ok) {
    const errBody = (body && typeof body === 'object' && 'error' in body)
      ? String((body as { error: unknown }).error)
      : res.statusText || `HTTP ${res.status}`;
    throw new ApiError(errBody, res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'json'>) => request<T>('GET', path, opts),
  post: <T>(path: string, json?: unknown, opts?: Omit<RequestOptions, 'json'>) =>
    request<T>('POST', path, { ...opts, json }),
  put: <T>(path: string, json?: unknown, opts?: Omit<RequestOptions, 'json'>) =>
    request<T>('PUT', path, { ...opts, json }),
  patch: <T>(path: string, json?: unknown, opts?: Omit<RequestOptions, 'json'>) =>
    request<T>('PATCH', path, { ...opts, json }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'json'>) =>
    request<T>('DELETE', path, opts),
};

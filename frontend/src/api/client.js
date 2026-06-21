// Thin fetch wrapper. We don't depend on axios to keep the bundle small.

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const TOKEN_KEY = 'ddns.token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, { json, signal, headers } = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const token = getToken();
  const init = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    signal,
  };
  if (json !== undefined) init.body = JSON.stringify(json);

  const res = await fetch(url, init);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (res.status === 401) {
    setToken('');
    // Notify the auth context if loaded (postMessage-like sentinel via event).
    window.dispatchEvent(new CustomEvent('ddns:unauthorized'));
  }
  if (!res.ok) {
    const msg = (body && body.error) || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return body;
}

export const api = {
  get:    (p, o) => request('GET', p, o),
  post:   (p, j, o) => request('POST', p, { ...o, json: j }),
  put:    (p, j, o) => request('PUT', p, { ...o, json: j }),
  patch:  (p, j, o) => request('PATCH', p, { ...o, json: j }),
  delete: (p, o) => request('DELETE', p, o),
};

/**
 * Calls go to this service's /bff prefix, never to the Atalaia API directly —
 * the API key lives on the server and is attached there.
 */

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Raised when the session cookie is missing or expired. */
export class AuthError extends ApiError {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/bff${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      (parsed as { error?: string })?.error ?? `${method} ${path} failed with ${res.status}`;
    if (res.status === 401) throw new AuthError(message, res.status, parsed);
    throw new ApiError(message, res.status, parsed);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => call<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => call<T>('DELETE', path),
};

export const auth = {
  async session(): Promise<boolean> {
    const res = await fetch('/auth/session', { credentials: 'same-origin' });
    if (!res.ok) return false;
    return (await res.json()).authenticated === true;
  },

  async login(password: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      credentials: 'same-origin',
    });

    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? `Login failed (${res.status})` };
  },

  async logout(): Promise<void> {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  },
};

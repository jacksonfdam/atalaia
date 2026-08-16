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

/**
 * A header a cross-origin form cannot set.
 *
 * The session cookie is SameSite=Lax, so a third-party page cannot POST with it
 * attached; this is the second lock on the same door. The server refuses any
 * state-changing request that arrives without it.
 */
export const CONSOLE_HEADER = { 'X-Atalaia-Console': '1' };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/bff${path}`, {
    method,
    headers:
      body === undefined
        ? CONSOLE_HEADER
        : { ...CONSOLE_HEADER, 'Content-Type': 'application/json' },
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

export interface Account {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export interface SessionInfo {
  authenticated: boolean;
  user?: Account;
  /** A recovery session may only enroll a passkey. */
  scope?: 'full' | 'recovery';
  credentialCount?: number;
  recoveryCodesRemaining?: number;
}

export interface AuthState {
  bootstrapped: boolean;
  setupPasswordConfigured: boolean;
  breakglassEnabled: boolean;
}

/**
 * The sign-in endpoints sit beside /bff rather than under it: they are how a
 * session comes to exist, so they cannot require one.
 */
async function authCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/auth${path}`, {
    method,
    headers:
      body === undefined
        ? CONSOLE_HEADER
        : { ...CONSOLE_HEADER, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  const parsed = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (parsed as { error?: string })?.error ?? `${method} ${path} failed (${res.status})`;
    throw new ApiError(message, res.status, parsed);
  }

  return parsed as T;
}

export const auth = {
  session: () => authCall<SessionInfo>('GET', '/session'),
  state: () => authCall<AuthState>('GET', '/state'),
  logout: () => authCall<unknown>('POST', '/logout').catch(() => undefined),
  call: authCall,
};

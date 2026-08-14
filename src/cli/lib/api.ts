/**
 * The CLI talks to the API over HTTP.
 *
 * It used to open the SQLite file directly, which was reasonable when the
 * database was a file next to the code. With Postgres it would mean handing a
 * connection string to every terminal that wants to run `atalaia status` —
 * so the CLI is a client of the same API the console uses, with the same key.
 */

export interface ApiOptions {
  baseUrl?: string;
  apiKey?: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function resolveBaseUrl(explicit?: string): string {
  const url = explicit ?? process.env.ATALAIA_API_URL ?? 'http://localhost:3000';
  return url.replace(/\/+$/, '');
}

function resolveApiKey(explicit?: string): string {
  const key = explicit ?? process.env.API_KEY;
  if (!key) {
    throw new Error(
      'API_KEY is not set. The CLI reads the API over HTTP now: export API_KEY (and ATALAIA_API_URL if the API is not on localhost:3000).'
    );
  }
  return key;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  baseUrl: string;
}

export function createClient(options: ApiOptions = {}): ApiClient {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const apiKey = resolveApiKey(options.apiKey);

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;

    try {
      res = await fetch(`${baseUrl}/api/v1${path}`, {
        method,
        headers: {
          'X-API-Key': apiKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // A refused connection is the common case — the API is not running — and
      // "fetch failed" on its own sends the reader looking in the wrong place.
      throw new Error(`Cannot reach the Atalaia API at ${baseUrl}: ${(err as Error).message}`);
    }

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
      throw new ApiError(message, res.status);
    }

    return parsed as T;
  }

  return {
    baseUrl,
    get: <T>(path: string) => call<T>('GET', path),
    post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
    patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body ?? {}),
    del: <T>(path: string) => call<T>('DELETE', path),
  };
}

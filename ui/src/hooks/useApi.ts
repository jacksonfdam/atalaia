import { useCallback, useEffect, useState } from 'react';
import { api, AuthError } from '../api/client';

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetch a GET endpoint, re-running whenever `path` changes.
 *
 * An expired session is not an endpoint error: it bubbles to the shell via
 * `onAuthLost` so the whole console returns to the login screen instead of
 * every panel rendering its own "Not authenticated".
 */
export function useApi<T>(path: string | null, onAuthLost?: () => void) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: Boolean(path) });

  const load = useCallback(async () => {
    if (!path) return;
    setState(prev => ({ ...prev, loading: true }));

    try {
      const data = await api.get<T>(path);
      setState({ data, error: null, loading: false });
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthLost?.();
        return;
      }
      setState({ data: null, error: (err as Error).message, loading: false });
    }
  }, [path, onAuthLost]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!path) {
        setState({ data: null, error: null, loading: false });
        return;
      }

      setState(prev => ({ ...prev, loading: true }));
      try {
        const data = await api.get<T>(path);
        // Discard a response that arrived after the caller moved on, so a slow
        // request cannot overwrite fresher data.
        if (active) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!active) return;
        if (err instanceof AuthError) {
          onAuthLost?.();
          return;
        }
        setState({ data: null, error: (err as Error).message, loading: false });
      }
    })();

    return () => {
      active = false;
    };
  }, [path, onAuthLost]);

  return { ...state, reload: load };
}

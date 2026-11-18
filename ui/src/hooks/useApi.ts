import { useCallback, useEffect, useRef, useState } from 'react';
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

  // The callback is read through a ref, never listed as a dependency. A caller
  // passing a fresh function on every render (an inline `() => {}`) would
  // otherwise restart the effect after each response, and each response sets
  // state and renders again: an endless request loop that fills the tab's memory.
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;

  const load = useCallback(async () => {
    if (!path) return;
    setState(prev => ({ ...prev, loading: true }));

    try {
      const data = await api.get<T>(path);
      setState({ data, error: null, loading: false });
    } catch (err) {
      if (err instanceof AuthError) {
        authLost.current?.();
        return;
      }
      setState({ data: null, error: (err as Error).message, loading: false });
    }
  }, [path]);

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
          authLost.current?.();
          return;
        }
        setState({ data: null, error: (err as Error).message, loading: false });
      }
    })();

    return () => {
      active = false;
    };
  }, [path]);

  return { ...state, reload: load };
}

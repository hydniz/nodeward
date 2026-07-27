import { useEffect, useState } from 'react';
import { announceUnauthorized } from './auth.js';

const cache = new Map();

/** dropped after a login, so the fresh session refetches everything. */
export function clearApiCache() {
  cache.clear();
}

export function useApi(path) {
  const [data, setData] = useState(cache.get(path) ?? null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (cache.has(path)) return undefined;
    fetch(path)
      .then((r) => {
        if (r.status === 401) {
          // the session is gone (expired, server restarted): hand control to
          // the AuthGate instead of rendering a wall of failed panels
          announceUnauthorized();
          throw new Error('login required');
        }
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((json) => {
        cache.set(path, json);
        if (alive) setData(json);
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [path]);

  return { data, error, loading: data === null && error === null };
}

import { useEffect, useState } from 'react';

const cache = new Map();

export function useApi(path) {
  const [data, setData] = useState(cache.get(path) ?? null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (cache.has(path)) return undefined;
    fetch(path)
      .then((r) => {
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

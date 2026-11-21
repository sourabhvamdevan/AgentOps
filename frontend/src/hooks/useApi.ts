import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export interface UseApiOptions {
  /** Re-run the loader on this interval (ms) without showing the loading state again. */
  pollMs?: number;
}

/** Minimal fetch-on-mount hook. `deps` re-trigger the loader. */
export function useApi<T>(loader: () => Promise<T>, deps: unknown[] = [], options: UseApiOptions = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const { pollMs } = options;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const run = (background: boolean) => {
      if (!background) setLoading(true);
      return loaderRef
        .current()
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(null);
          }
        })
        .catch((e: Error) => !cancelled && setError(e))
        .finally(() => !cancelled && setLoading(false));
    };
    void run(false);
    const timer = pollMs ? setInterval(() => void run(true), pollMs) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, pollMs, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

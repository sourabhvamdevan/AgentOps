import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../services/api";
import type { ExecutionDetail, ExecutionEvent } from "../types";
import { TERMINAL_STATUSES } from "../types";
import { type StreamState, useExecutionStream } from "./useExecutionStream";

// Events after which the persisted execution record has meaningfully changed.
const REFRESH_ON = new Set([
  "agent_completed",
  "agent_failed",
  "approval_requested",
  "approval_received",
  "workflow_completed",
  "workflow_failed",
]);

export interface ExecutionView {
  detail: ExecutionDetail | null;
  events: ExecutionEvent[];
  loading: boolean;
  error: Error | null;
  stream: StreamState;
  refresh: () => Promise<void>;
}

/**
 * Loads an execution from REST (detail + persisted events), then follows it over the WebSocket.
 * Survives page refresh: everything shown comes from the backend.
 */
export function useExecution(executionId: string | null): ExecutionView {
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [eventMap, setEventMap] = useState<Map<number, ExecutionEvent>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [initialSeq, setInitialSeq] = useState<number | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentId = useRef(executionId);
  currentId.current = executionId;

  const refresh = useCallback(async () => {
    if (!executionId) return;
    try {
      const d = await api.execution(executionId);
      if (currentId.current === executionId) setDetail(d);
    } catch (e) {
      if (currentId.current === executionId) setError(e as Error);
    }
  }, [executionId]);

  useEffect(() => {
    setDetail(null);
    setEventMap(new Map());
    setInitialSeq(null);
    setError(null);
    if (!executionId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([api.execution(executionId), api.events(executionId)])
      .then(([d, ev]) => {
        if (cancelled) return;
        setDetail(d);
        setEventMap(new Map(ev.items.map((e) => [e.sequence, e])));
        setInitialSeq(ev.items.length ? ev.items[ev.items.length - 1].sequence : 0);
      })
      .catch((e: Error) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [executionId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 120);
  }, [refresh]);

  const onEvent = useCallback(
    (event: ExecutionEvent) => {
      setEventMap((prev) => {
        if (prev.has(event.sequence)) return prev;
        const next = new Map(prev);
        next.set(event.sequence, event);
        return next;
      });
      if (REFRESH_ON.has(event.event_type)) scheduleRefresh();
    },
    [scheduleRefresh],
  );

  const terminal = detail ? TERMINAL_STATUSES.includes(detail.status) : false;
  const streamEnabled = initialSeq !== null && !!detail && !terminal;
  const stream = useExecutionStream(executionId, streamEnabled, initialSeq ?? 0, onEvent, scheduleRefresh);

  const events = useMemo(() => [...eventMap.values()].sort((a, b) => a.sequence - b.sequence), [eventMap]);
  return { detail, events, loading, error, stream, refresh };
}

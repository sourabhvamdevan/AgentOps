import { useEffect, useRef, useState } from "react";

import { openExecutionStream } from "../services/ws";
import type { ExecutionEvent } from "../types";

export type StreamState = "idle" | "connecting" | "live" | "reconnecting" | "closed" | "offline";

const MAX_RETRIES = 5;

/**
 * Subscribes to an execution's event stream. The server replays persisted events after
 * `afterSequence` and then streams live ones; on an unexpected drop we reconnect from the last
 * sequence we saw, so nothing is missed or duplicated.
 */
export function useExecutionStream(
  executionId: string | null,
  enabled: boolean,
  afterSequence: number,
  onEvent: (event: ExecutionEvent) => void,
  onClosed: () => void,
): StreamState {
  const [state, setState] = useState<StreamState>("idle");
  const lastSeq = useRef(afterSequence);
  const handlers = useRef({ onEvent, onClosed });
  handlers.current = { onEvent, onClosed };

  useEffect(() => {
    if (!executionId || !enabled) {
      setState("idle");
      return;
    }
    lastSeq.current = afterSequence;
    let retries = 0;
    let close: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const connect = () => {
      setState(retries === 0 ? "connecting" : "reconnecting");
      close = openExecutionStream(executionId, lastSeq.current, {
        onOpen: () => {
          retries = 0;
          setState("live");
        },
        onMessage: (msg) => {
          if (msg.type === "event") {
            lastSeq.current = Math.max(lastSeq.current, msg.event.sequence);
            handlers.current.onEvent(msg.event);
          } else if (msg.type === "closed") {
            finished = true;
            setState("closed");
            handlers.current.onClosed();
          } else {
            finished = true;
            setState("offline");
          }
        },
        onDrop: () => {
          if (finished) return;
          if (retries >= MAX_RETRIES) {
            setState("offline");
            return;
          }
          retries += 1;
          setState("reconnecting");
          timer = setTimeout(connect, 500 * 2 ** retries);
        },
      });
    };
    connect();
    return () => {
      finished = true;
      if (timer) clearTimeout(timer);
      close?.();
    };
    // afterSequence is only the starting point; later changes must not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionId, enabled]);

  return state;
}

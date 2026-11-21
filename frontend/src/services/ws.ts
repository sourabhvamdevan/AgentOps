import { getSyntheticStore } from "../synthetic/router";
import type { StreamMessage } from "../types";
import { API_BASE_URL } from "./api";
import { getConnection } from "./connection";

export function streamUrl(executionId: string, afterSequence: number): string {
  const base = API_BASE_URL.startsWith("http")
    ? API_BASE_URL.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${API_BASE_URL}`;
  return `${base}/executions/${executionId}/stream?after_sequence=${afterSequence}`;
}

export interface StreamHandlers {
  onMessage: (msg: StreamMessage) => void;
  onOpen?: () => void;
  onDrop?: () => void;
}

/**
 * Opens one event stream. Returns a function that closes it. Reconnect policy lives in the hook.
 * In synthetic mode the stream comes from the in-browser engine instead of a WebSocket.
 */
export function openExecutionStream(executionId: string, afterSequence: number, handlers: StreamHandlers): () => void {
  if (getConnection().mode === "synthetic") {
    return getSyntheticStore().stream(executionId, afterSequence, handlers.onMessage, handlers.onOpen);
  }
  const ws = new WebSocket(streamUrl(executionId, afterSequence));
  let closedByUs = false;
  ws.onopen = () => handlers.onOpen?.();
  ws.onmessage = (e) => {
    try {
      handlers.onMessage(JSON.parse(e.data) as StreamMessage);
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    if (!closedByUs) handlers.onDrop?.();
  };
  return () => {
    closedByUs = true;
    ws.close();
  };
}

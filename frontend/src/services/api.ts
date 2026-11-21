import { handleSyntheticRequest } from "../synthetic/router";
import type {
  AgentDetail,
  AgentListItem,
  Approval,
  ExecutionDetail,
  ExecutionEvent,
  ExecutionSummary,
  Health,
  MonitorSummary,
  Page,
  WorkflowDefinition,
  WorkflowListItem,
} from "../types";
import { beginProbe, getConnection, markLive, markSynthetic } from "./connection";
import { ApiError, isConnectivityError } from "./errors";

export { ApiError } from "./errors";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, "");
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 5000);

/** One real HTTP call. Anything that means "this is not a working API" is reported as a connectivity error. */
async function liveRequest<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === "AbortError";
    throw new ApiError(0, timedOut ? "timeout" : "network_error", timedOut ? `The backend at ${API_BASE_URL} did not answer within ${timeoutMs} ms.` : `Cannot reach the backend at ${API_BASE_URL}. Is it running?`);
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    if (!err && res.status >= 500) throw new ApiError(res.status, "http_error", `Backend returned ${res.status}`);
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  if (body === null) throw new ApiError(0, "invalid_response", `${API_BASE_URL}${path} did not return JSON (is this the API?)`);
  return body as T;
}

let probe: Promise<boolean> | null = null;

/** Probes /health once; every request issued while probing waits for the same answer. */
function ensureProbed(): Promise<boolean> {
  return (probe ??= liveRequest<{ status?: string }>("/health")
    .then((h) => {
      if (h?.status !== "ok") throw new ApiError(0, "invalid_response", "Health check did not report ok");
      markLive();
      return true;
    })
    .catch((e: Error) => {
      markSynthetic(e.message);
      return false;
    }));
}

/** Try the backend again. Resolves true (and the caller should reload) when it answers. */
export async function retryLiveBackend(): Promise<boolean> {
  if (getConnection().policy === "always") return false;
  probe = null;
  beginProbe();
  return ensureProbed();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const conn = getConnection();
  if (conn.mode === "synthetic") return handleSyntheticRequest<T>(path, init);
  if (conn.policy === "auto" && conn.mode === "probing") {
    if (!(await ensureProbed())) return handleSyntheticRequest<T>(path, init);
  }
  try {
    const out = await liveRequest<T>(path, init);
    markLive();
    return out;
  } catch (e) {
    if (getConnection().policy === "auto" && isConnectivityError(e)) {
      markSynthetic((e as Error).message);
      return handleSyntheticRequest<T>(path, init);
    }
    throw e;
  }
}

export const api = {
  health: () => request<Health>("/health"),
  workflows: () => request<{ items: WorkflowListItem[] }>("/workflows"),
  workflow: (id: string) => request<WorkflowDefinition>(`/workflows/${id}`),
  agents: () => request<{ items: AgentListItem[] }>("/agents"),
  agent: (id: string) => request<AgentDetail>(`/agents/${id}`),
  createExecution: (text: string, idempotencyKey?: string) =>
    request<ExecutionSummary>("/executions", {
      method: "POST",
      body: JSON.stringify({ request: text }),
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    }),
  executions: (limit = 10, offset = 0) => request<Page<ExecutionSummary>>(`/executions?limit=${limit}&offset=${offset}`),
  execution: (id: string) => request<ExecutionDetail>(`/executions/${id}`),
  events: (id: string, afterSequence = 0) =>
    request<{ items: ExecutionEvent[] }>(`/executions/${id}/events?after_sequence=${afterSequence}`),
  decide: (approvalId: string, decision: "approve" | "reject", comment?: string) =>
    request<Approval>(`/approvals/${approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, comment: comment || null }),
    }),
  resetDemo: () => request<{ status: string; message: string }>("/demo/reset", { method: "POST" }),
  monitorSummary: () => request<MonitorSummary>("/monitor/summary"),
};

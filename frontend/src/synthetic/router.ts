/** Maps REST paths (relative to the API base) onto the synthetic store, returning the same JSON shapes as the backend. */
import { ApiError } from "../services/errors";
import { AGENT_LIST, agentDetail, WORKFLOW, WORKFLOW_ID, WORKFLOW_LIST } from "./meta";
import { StoreError, SyntheticStore } from "./store";

let singleton: SyntheticStore | null = null;
export function getSyntheticStore(): SyntheticStore {
  return (singleton ??= new SyntheticStore());
}
/** Test hook. */
export function __setSyntheticStore(s: SyntheticStore | null) {
  singleton = s;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function body(init?: RequestInit): Record<string, unknown> {
  try {
    return init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers;
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  const entry = Object.entries(h as Record<string, string>).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

export async function handleSyntheticRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const store = getSyntheticStore();
  await store.ready;
  await delay(40); // small latency so loading states behave like a real network call
  const method = (init?.method ?? "GET").toUpperCase();
  const url = new URL(path, "http://synthetic.local");
  const p = url.pathname.replace(/\/$/, "");
  const q = url.searchParams;

  try {
    const out = await route(store, method, p, q, init);
    return out as T;
  } catch (e) {
    if (e instanceof StoreError) throw new ApiError(e.status, e.code, e.message, e.details);
    throw e;
  }
}

async function route(store: SyntheticStore, method: string, p: string, q: URLSearchParams, init?: RequestInit): Promise<unknown> {
  const notFound = (what: string, id: string) => new ApiError(404, "not_found", `${what} '${id}' not found`);
  let m: RegExpMatchArray | null;

  if (method === "GET" && p === "/health") return store.health();
  if (method === "GET" && p === "/workflows") return { items: WORKFLOW_LIST };
  if (method === "GET" && (m = p.match(/^\/workflows\/([^/]+)$/))) {
    if (m[1] !== WORKFLOW_ID) throw notFound("Workflow", m[1]);
    return WORKFLOW;
  }
  if (method === "GET" && p === "/agents") return { items: AGENT_LIST };
  if (method === "GET" && (m = p.match(/^\/agents\/([^/]+)$/))) {
    const a = agentDetail(m[1]);
    if (!a) throw notFound("Agent", m[1]);
    return a;
  }
  if (method === "GET" && p === "/monitor/summary") return store.monitor();

  if (method === "POST" && p === "/executions") {
    const { record } = store.create(String(body(init).request ?? ""), header(init, "Idempotency-Key"));
    return store.list(1000, 0).items.find((e) => e.id === record.id);
  }
  if (method === "GET" && p === "/executions") {
    const limit = Math.min(100, Math.max(1, Number(q.get("limit") ?? 20)));
    const offset = Math.max(0, Number(q.get("offset") ?? 0));
    return store.list(limit, offset);
  }
  if (method === "GET" && (m = p.match(/^\/executions\/([^/]+)\/events$/))) {
    return { items: store.events(m[1], Math.max(0, Number(q.get("after_sequence") ?? 0))) };
  }
  if (method === "GET" && (m = p.match(/^\/executions\/([^/]+)$/))) return store.detail(m[1]);

  if (method === "GET" && p === "/approvals") return { items: store.approvals(q.get("status")) };
  if (method === "POST" && (m = p.match(/^\/approvals\/([^/]+)\/decision$/))) {
    const b = body(init);
    if (b.decision !== "approve" && b.decision !== "reject")
      throw new ApiError(422, "validation_error", "Request validation failed", [{ loc: ["body", "decision"], msg: "decision must be 'approve' or 'reject'", type: "literal_error" }]);
    return store.decide(m[1], b.decision, (b.comment as string | null) ?? null);
  }

  if (method === "POST" && p === "/demo/reset") {
    await store.reset();
    return { status: "reset", message: "Synthetic runtime reset; sample history re-generated." };
  }
  throw new ApiError(404, "not_found", `No synthetic route for ${method} ${p}`);
}

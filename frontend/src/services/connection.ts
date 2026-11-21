/**
 * Tracks whether the app is talking to the real backend ("live") or to the built-in synthetic engine
 * ("synthetic"). The synthetic engine takes over when the API is unreachable, times out, or answers
 * with something that is not the API (e.g. an SPA fallback page on a static host).
 *
 * VITE_SYNTHETIC_MODE:  auto (default) | always | never
 */
export type ConnectionMode = "probing" | "live" | "synthetic";
export type SyntheticPolicy = "auto" | "always" | "never";

export interface ConnectionState {
  mode: ConnectionMode;
  reason: string | null;
  since: number;
  policy: SyntheticPolicy;
}

function readPolicy(): SyntheticPolicy {
  const v = String(import.meta.env.VITE_SYNTHETIC_MODE ?? "auto").toLowerCase();
  return v === "always" || v === "never" ? v : "auto";
}

const policy = readPolicy();
let state: ConnectionState =
  policy === "always"
    ? { mode: "synthetic", reason: "Synthetic mode is forced by VITE_SYNTHETIC_MODE=always", since: Date.now(), policy }
    : { mode: policy === "never" ? "live" : "probing", reason: null, since: Date.now(), policy };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getConnection = (): ConnectionState => state;
export const subscribeConnection = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function set(next: Partial<ConnectionState>) {
  state = { ...state, ...next, since: Date.now() };
  emit();
}

export function markLive() {
  if (state.mode !== "live") set({ mode: "live", reason: null });
}

export function markSynthetic(reason: string) {
  if (state.policy === "never") return;
  if (state.mode !== "synthetic") set({ mode: "synthetic", reason });
}

export function beginProbe() {
  if (state.policy === "auto") set({ mode: "probing", reason: null });
}

/** Test helper. */
export function __resetConnectionForTests(mode: ConnectionMode = "probing", p: SyntheticPolicy = "auto") {
  state = { mode, reason: null, since: Date.now(), policy: p };
  emit();
}

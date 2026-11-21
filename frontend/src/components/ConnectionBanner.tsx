import { DatabaseZap, RefreshCw, Wifi } from "lucide-react";
import { useState } from "react";

import { useConnection } from "../hooks/useConnection";
import { retryLiveBackend } from "../services/api";
import { Button } from "./ui/button";

/** Small status line for the sidebar footer. */
export function ConnectionPill() {
  const conn = useConnection();
  if (conn.mode === "probing") return <div className="text-sidebar-muted">Connecting to backend…</div>;
  if (conn.mode === "synthetic")
    return (
      <div className="flex items-center gap-1.5 text-sidebar-fg" data-testid="connection-pill" data-mode="synthetic">
        <DatabaseZap size={12} aria-hidden /> Synthetic engine (offline)
      </div>
    );
  return (
    <div className="flex items-center gap-1.5 text-sidebar-fg" data-testid="connection-pill" data-mode="live">
      <Wifi size={12} aria-hidden /> Live backend
    </div>
  );
}

/** Shown whenever the built-in synthetic engine has taken over from an unreachable API. */
export function ConnectionBanner() {
  const conn = useConnection();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (conn.mode !== "synthetic") return null;

  const retry = async () => {
    setBusy(true);
    setMsg(null);
    const ok = await retryLiveBackend();
    setBusy(false);
    if (ok) window.location.reload();
    else setMsg("Backend still unreachable. Staying on synthetic data.");
  };

  return (
    <div
      role="status"
      data-testid="synthetic-banner"
      className="flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm"
    >
      <DatabaseZap size={16} className="shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-accent-strong">Synthetic data engine active.</span>{" "}
        <span className="text-fg">
          The API is unreachable, so AgentOps is running the full workflow in your browser with synthetic data. Nothing leaves this page.
        </span>
        {conn.reason && <div className="truncate text-xs text-muted">Reason: {conn.reason}</div>}
        {msg && <div className="text-xs text-accent-strong">{msg}</div>}
      </div>
      {conn.policy !== "always" && (
        <Button size="sm" variant="outline" onClick={retry} disabled={busy}>
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {busy ? "Checking…" : "Retry backend"}
        </Button>
      )}
    </div>
  );
}

import type { AgentStatus, ExecutionStatus, Outcome } from "../types";
import { Badge, type BadgeTone } from "./ui/badge";

const STATUS: Record<ExecutionStatus, { label: string; tone: BadgeTone }> = {
  created: { label: "Created", tone: "neutral" },
  running: { label: "Running", tone: "accent" },
  waiting_for_approval: { label: "Waiting for approval", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const OUTCOME: Record<Outcome, { label: string; tone: BadgeTone }> = {
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  failed_validation: { label: "Failed validation", tone: "warning" },
  error: { label: "Error", tone: "danger" },
};

const AGENT: Record<AgentStatus, BadgeTone> = {
  pending: "neutral",
  running: "accent",
  completed: "success",
  failed: "danger",
  skipped: "neutral",
};

export function StatusBadge({ status }: { status: ExecutionStatus }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} data-testid="status-badge">
      {status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
      {s.label}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  const o = OUTCOME[outcome];
  return <Badge tone={o.tone}>Outcome: {o.label}</Badge>;
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return <Badge tone={AGENT[status]}>{status}</Badge>;
}

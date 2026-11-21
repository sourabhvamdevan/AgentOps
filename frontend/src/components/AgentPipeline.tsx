import { Check, ChevronRight, Circle, Loader2, MinusCircle, UserCheck, X } from "lucide-react";
import { Fragment } from "react";

import { cn } from "../lib/utils";
import type { AgentId, AgentStatus } from "../types";
import { AGENT_IDS } from "../types";
import { AGENT_LABELS } from "./eventSummary";

export type HumanStepStatus = "pending" | "waiting" | "approved" | "rejected" | "skipped";

const STYLE: Record<AgentStatus | HumanStepStatus, string> = {
  pending: "border-border text-muted bg-bg",
  running: "border-accent text-accent bg-accent-soft",
  waiting: "border-warning text-warning bg-warning-soft",
  completed: "border-success/40 text-success bg-success-soft",
  approved: "border-success/40 text-success bg-success-soft",
  failed: "border-danger/40 text-danger bg-danger-soft",
  rejected: "border-danger/40 text-danger bg-danger-soft",
  skipped: "border-border border-dashed text-muted bg-surface",
};

function Icon({ status }: { status: AgentStatus | HumanStepStatus }) {
  const p = { size: 14, "aria-hidden": true } as const;
  if (status === "running") return <Loader2 {...p} className="animate-spin" />;
  if (status === "completed" || status === "approved") return <Check {...p} />;
  if (status === "failed" || status === "rejected") return <X {...p} />;
  if (status === "skipped") return <MinusCircle {...p} />;
  if (status === "waiting") return <UserCheck {...p} />;
  return <Circle {...p} />;
}

export function AgentPipeline({
  statuses,
  human,
  selected,
  onSelect,
}: {
  statuses: Record<AgentId, AgentStatus>;
  human: HumanStepStatus;
  selected?: AgentId | null;
  onSelect?: (agent: AgentId) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Agent pipeline">
      {AGENT_IDS.map((id) => (
        <Fragment key={id}>
          <button
            type="button"
            onClick={() => onSelect?.(id)}
            data-testid={`pipeline-${id}`}
            data-status={statuses[id]}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              STYLE[statuses[id]],
              selected === id && "ring-2 ring-accent/40",
            )}
          >
            <Icon status={statuses[id]} /> {AGENT_LABELS[id]}
            <span className="sr-only">: {statuses[id]}</span>
          </button>
          <ChevronRight size={14} className="text-muted" aria-hidden />
        </Fragment>
      ))}
      <span
        data-testid="pipeline-human_review"
        data-status={human}
        className={cn("flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium", STYLE[human])}
      >
        <Icon status={human} /> Human Review
        <span className="sr-only">: {human}</span>
      </span>
    </div>
  );
}

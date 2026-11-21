import { formatINR, humanize } from "../lib/utils";
import type { ExecutionEvent } from "../types";

type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const AGENT_LABELS: Record<string, string> = {
  request_agent: "Request Agent",
  vendor_agent: "Vendor Agent",
  budget_agent: "Budget Agent",
  approval_agent: "Approval Agent",
};

/** One-line, human-readable summary of a persisted event. */
export function summarizeEvent(e: ExecutionEvent): string {
  const d = e.data as D;
  switch (e.event_type) {
    case "workflow_initialized":
      return `Workflow started in ${d.execution_mode} mode`;
    case "agent_started":
      return `${AGENT_LABELS[e.agent_id ?? ""] ?? e.agent_id} started`;
    case "tool_invoked":
      return `Called ${d.tool}`;
    case "tool_completed":
      return `${d.tool} returned ${d.result_summary ?? ""}`.trim();
    case "agent_completed": {
      const o = (d.output ?? {}) as D;
      if (e.agent_id === "request_agent")
        return o.status === "valid"
          ? `Parsed: ${o.quantity} × ${o.product}, ${o.department}, max ${formatINR(o.maximum_budget)}`
          : `Request invalid: ${o.reason ?? "missing fields"}`;
      if (e.agent_id === "vendor_agent")
        return o.recommended_vendor_id ? `Recommended ${o.recommended_vendor_id}` : "No vendor within maximum budget";
      if (e.agent_id === "budget_agent") return `Budget ${o.status}: ${formatINR(o.requested_amount)} requested`;
      if (e.agent_id === "approval_agent")
        return `Recommend ${o.recommendation}${o.approval_required ? " · human approval required" : ""}`;
      return "Completed";
    }
    case "agent_failed":
      return `${d.error?.class}: ${d.error?.message}`;
    case "branch_selected":
      return `Routed ${humanize(String(d.from))} → ${humanize(String(d.branch))}`;
    case "approval_requested":
      return `Waiting for human approval of ${formatINR(d.summary?.requested_amount)}`;
    case "approval_received":
      return `Human ${d.decision === "approve" ? "approved" : "rejected"}${d.comment ? `: “${d.comment}”` : ""}`;
    case "workflow_completed":
      return `Workflow completed · outcome ${humanize(String(d.outcome))}`;
    case "workflow_failed":
      return `Workflow failed · ${d.error?.class}: ${d.error?.message}`;
    default:
      return e.event_type;
  }
}

export function eventTone(e: ExecutionEvent): "accent" | "success" | "warning" | "danger" | "neutral" {
  switch (e.event_type) {
    case "agent_failed":
    case "workflow_failed":
      return "danger";
    case "approval_requested":
      return "warning";
    case "agent_completed":
    case "workflow_completed":
    case "approval_received":
      return "success";
    case "branch_selected":
    case "workflow_initialized":
      return "accent";
    default:
      return "neutral";
  }
}

import type { HumanStepStatus } from "../components/AgentPipeline";
import type { AgentId, AgentStatus, ExecutionDetail, ExecutionEvent } from "../types";
import { AGENT_IDS, TERMINAL_STATUSES } from "../types";

/** Agent statuses derived from persisted events (live) on top of the last fetched detail. */
export function deriveAgentStatuses(events: ExecutionEvent[], detail: ExecutionDetail | null): Record<AgentId, AgentStatus> {
  const statuses = Object.fromEntries(AGENT_IDS.map((a) => [a, "pending"])) as Record<AgentId, AgentStatus>;
  for (const e of events) {
    const id = e.agent_id as AgentId | null;
    if (!id || !(id in statuses)) continue;
    if (e.event_type === "agent_started") statuses[id] = "running";
    if (e.event_type === "agent_completed") statuses[id] = "completed";
    if (e.event_type === "agent_failed") statuses[id] = "failed";
  }
  const terminal =
    events.some((e) => e.event_type === "workflow_completed" || e.event_type === "workflow_failed") ||
    (detail ? TERMINAL_STATUSES.includes(detail.status) : false);
  if (terminal) {
    for (const id of AGENT_IDS) {
      if (statuses[id] === "pending" || statuses[id] === "running") {
        statuses[id] = detail?.agent_statuses?.[id] === "failed" ? "failed" : "skipped";
      }
    }
  }
  return statuses;
}

export function deriveHumanStep(events: ExecutionEvent[], detail: ExecutionDetail | null): HumanStepStatus {
  const received = [...events].reverse().find((e) => e.event_type === "approval_received");
  if (received) return received.data.decision === "approve" ? "approved" : "rejected";
  if (detail?.approval?.status === "approved") return "approved";
  if (detail?.approval?.status === "rejected") return "rejected";
  if (events.some((e) => e.event_type === "approval_requested")) return "waiting";
  const terminal =
    events.some((e) => e.event_type === "workflow_completed" || e.event_type === "workflow_failed") ||
    (detail ? TERMINAL_STATUSES.includes(detail.status) : false);
  return terminal ? "skipped" : "pending";
}

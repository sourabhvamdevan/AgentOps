import type { MonitorSummary } from "../types";
import { formatAge, formatPercent, humanize } from "../lib/utils";

export const APPROVAL_STALE_SECONDS = 3600;
export const AGENT_SUCCESS_FLOOR = 0.95;
export const MIN_RUNS_FOR_AGENT_ALERT = 3;

export interface MonitorAlert {
  id: string;
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
  executionId?: string;
}

/** Turns a monitor summary into the alert list shown at the top of the Workflow Monitor. */
export function deriveAlerts(s: MonitorSummary): MonitorAlert[] {
  const alerts: MonitorAlert[] = [];

  if (s.totals.failed > 0) {
    const last = s.recent_failures[0];
    alerts.push({
      id: "failed-runs",
      level: "critical",
      title: `${s.totals.failed} execution${s.totals.failed === 1 ? "" : "s"} failed`,
      detail: last ? `Latest: ${last.error_class} in ${last.agent_id ? humanize(last.agent_id) : "the orchestrator"}: ${last.message}` : "See the failure list below.",
      executionId: last?.execution_id,
    });
  }

  for (const a of s.pending_approvals.filter((p) => p.age_seconds > APPROVAL_STALE_SECONDS)) {
    alerts.push({
      id: `stale-${a.approval_id}`,
      level: "warning",
      title: "Approval waiting too long",
      detail: `${a.department ?? "A"} ${a.product ?? "purchase"} has waited ${formatAge(a.age_seconds)} for a human decision.`,
      executionId: a.execution_id,
    });
  }

  for (const a of s.agents) {
    if (a.runs >= MIN_RUNS_FOR_AGENT_ALERT && a.success_rate !== null && a.success_rate < AGENT_SUCCESS_FLOOR) {
      alerts.push({
        id: `agent-${a.agent_id}`,
        level: "warning",
        title: `${humanize(a.agent_id)} below ${formatPercent(AGENT_SUCCESS_FLOOR)} success`,
        detail: `${a.failed} of ${a.completed + a.failed} runs failed (${formatPercent(a.success_rate)} success).`,
      });
    }
  }

  if (!alerts.length)
    alerts.push({ id: "healthy", level: "info", title: "All systems nominal", detail: "No failed runs, stale approvals or degraded agents." });
  return alerts;
}

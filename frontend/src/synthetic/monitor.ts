/** Aggregates execution records into the Workflow Monitor summary. Mirrors backend/app/services/monitor_service.py. */
import type { AgentHealth, ExecutionSummary, MonitorBucket, MonitorSummary, Outcome } from "../types";
import { AGENT_IDS } from "../types";
import type { ExecRecord } from "./records";

const HOUR = 3_600_000;
const BUCKETS = 24;

const STAGES: { stage: string; label: string }[] = [
  { stage: "submitted", label: "Submitted" },
  { stage: "request_agent", label: "Request Agent" },
  { stage: "vendor_agent", label: "Vendor Agent" },
  { stage: "budget_agent", label: "Budget Agent" },
  { stage: "approval_agent", label: "Approval Agent" },
  { stage: "human_review", label: "Human Review" },
  { stage: "finalized", label: "Finalized" },
];

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1)); // nearest-rank
  return s[idx];
}
const ratio = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 1000 : null);
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

export function toSummary(r: ExecRecord): ExecutionSummary {
  return {
    id: r.id,
    status: r.status,
    execution_mode: r.execution_mode,
    raw_request: r.raw_request,
    current_stage: r.current_stage,
    outcome: r.outcome,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

export function buildMonitorSummary(records: ExecRecord[], now: Date, dataSource = "synthetic"): MonitorSummary {
  const nowMs = now.getTime();
  const sorted = [...records].sort((a, b) => ms(b.created_at) - ms(a.created_at));

  const totals = {
    executions: records.length,
    running: records.filter((r) => r.status === "running" || r.status === "created").length,
    waiting_for_approval: records.filter((r) => r.status === "waiting_for_approval").length,
    completed: records.filter((r) => r.status === "completed").length,
    failed: records.filter((r) => r.status === "failed").length,
  };
  const outcomes: Record<Outcome, number> = { approved: 0, rejected: 0, failed_validation: 0, error: 0 };
  for (const r of records) if (r.outcome) outcomes[r.outcome] += 1;

  const terminal = totals.completed + totals.failed;
  const decided = outcomes.approved + outcomes.rejected;
  const completedRuns = records.filter((r) => r.status === "completed");
  const autoResolved = completedRuns.filter((r) => !r.approval).length;

  // End-to-end latency of fully automated runs (no human wait inflating the numbers).
  const durations = records
    .filter((r) => (r.status === "completed" || r.status === "failed") && !r.approval && r.completed_at)
    .map((r) => ms(r.completed_at) - ms(r.created_at))
    .filter((d) => d >= 0);

  const waits = records
    .filter((r) => r.approval?.decided_at)
    .map((r) => ms(r.approval!.decided_at) - ms(r.approval!.requested_at))
    .filter((d) => d >= 0);

  const agents: AgentHealth[] = AGENT_IDS.map((agent_id) => {
    const rows = records.flatMap((r) => r.agent_executions.filter((a) => a.agent_id === agent_id));
    const done = rows.filter((a) => a.status === "completed");
    const failed = rows.filter((a) => a.status === "failed");
    const ds = [...done, ...failed].map((a) => a.duration_ms).filter((d): d is number => d !== null);
    return {
      agent_id,
      runs: rows.length,
      completed: done.length,
      failed: failed.length,
      success_rate: ratio(done.length, done.length + failed.length),
      avg_duration_ms: avg(ds),
      p95_duration_ms: percentile(ds, 95),
    };
  });

  const reached = (agent: string) => records.filter((r) => r.agent_executions.some((a) => a.agent_id === agent)).length;
  const stages = STAGES.map(({ stage, label }) => ({
    stage,
    label,
    reached:
      stage === "submitted"
        ? records.length
        : stage === "human_review"
          ? records.filter((r) => r.approval).length
          : stage === "finalized"
            ? completedRuns.length
            : reached(stage),
  }));

  const endHour = Math.floor(nowMs / HOUR) * HOUR;
  const throughput: MonitorBucket[] = Array.from({ length: BUCKETS }, (_, i) => ({
    bucket_start: new Date(endHour - (BUCKETS - 1 - i) * HOUR).toISOString(),
    total: 0,
    approved: 0,
    rejected: 0,
    failed_validation: 0,
    error: 0,
  }));
  for (const r of records) {
    const idx = BUCKETS - 1 - Math.floor((endHour - Math.floor(ms(r.created_at) / HOUR) * HOUR) / HOUR);
    if (idx < 0 || idx >= BUCKETS) continue;
    throughput[idx].total += 1;
    if (r.outcome) throughput[idx][r.outcome] += 1;
  }

  const pending_approvals = records
    .filter((r) => r.approval?.status === "pending")
    .map((r) => {
      const a = r.approval!;
      return {
        approval_id: a.id,
        execution_id: r.id,
        requested_at: a.requested_at,
        age_seconds: Math.max(0, Math.round((nowMs - ms(a.requested_at)) / 1000)),
        requested_amount: a.summary.requested_amount ?? null,
        department: a.summary.department ?? null,
        product: a.summary.product ?? null,
        vendor: a.summary.vendor?.name ?? null,
      };
    })
    .sort((a, b) => b.age_seconds - a.age_seconds);

  const recent_failures = sorted
    .filter((r) => r.status === "failed" && r.error)
    .slice(0, 5)
    .map((r) => ({
      execution_id: r.id,
      at: r.completed_at,
      agent_id: r.error!.agent_id,
      error_class: r.error!.class,
      message: r.error!.message,
      retryable: r.error!.retryable,
    }));

  const active = sorted.filter((r) => ["created", "running", "waiting_for_approval"].includes(r.status)).slice(0, 10).map(toSummary);

  return {
    generated_at: now.toISOString(),
    data_source: dataSource,
    totals,
    outcomes,
    rates: {
      completion_rate: ratio(totals.completed, terminal),
      failure_rate: ratio(totals.failed, terminal),
      approval_rate: ratio(outcomes.approved, decided),
      auto_resolution_rate: ratio(autoResolved, completedRuns.length),
    },
    duration_ms: { avg: avg(durations), p50: percentile(durations, 50), p95: percentile(durations, 95) },
    approval_wait_ms: { avg: avg(waits), max: waits.length ? Math.max(...waits) : null },
    agents,
    stages,
    throughput,
    pending_approvals,
    recent_failures,
    active,
  };
}

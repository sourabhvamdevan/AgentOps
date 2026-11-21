import { Activity, AlertTriangle, CheckCircle2, Clock, Pause, Play, ShieldAlert, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";

import { ErrorBanner, Loading } from "../components/PageState";
import { StatusBadge } from "../components/StatusBadge";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useApi } from "../hooks/useApi";
import { useConnection } from "../hooks/useConnection";
import { cn, formatAge, formatDuration, formatINR, formatPercent, formatTime, humanize } from "../lib/utils";
import { api } from "../services/api";
import { getSyntheticStore } from "../synthetic/router";
import type { MonitorBucket, MonitorSummary, Outcome } from "../types";
import { deriveAlerts, type MonitorAlert } from "./monitorAlerts";

const POLL_MS = 3000;

const OUTCOME_STYLE: Record<Outcome, { label: string; bar: string }> = {
  approved: { label: "Approved", bar: "bg-success" },
  rejected: { label: "Rejected", bar: "bg-accent" },
  failed_validation: { label: "Failed validation", bar: "bg-warning" },
  error: { label: "Error", bar: "bg-danger" },
};
const OUTCOMES = Object.keys(OUTCOME_STYLE) as Outcome[];

const LOAD_SAMPLES = [
  "Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.",
  "Buy 2 monitors for the Finance department with a maximum budget of ₹50,000.",
  "Order 25 keyboards for the HR department with a maximum budget of ₹1,00,000.",
  "Purchase 5 laptops for the marketing department with a maximum budget of ₹1,00,000.",
  "Purchase 4 laptops for the HR department with a maximum budget of ₹4,00,000. simulate failure",
  "buy some stuff",
];

function Kpi({ icon, label, value, sub, tone = "default" }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "accent" | "danger" }) {
  return (
    <Card className={cn(tone === "accent" && "border-accent/40", tone === "danger" && "border-danger/40")}>
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <span className={cn(tone === "accent" && "text-accent", tone === "danger" && "text-danger")}>{icon}</span> {label}
        </div>
        <div className="text-2xl font-semibold tracking-tight" data-testid={`kpi-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const ALERT_STYLE: Record<MonitorAlert["level"], { box: string; icon: ReactNode }> = {
  critical: { box: "border-danger/40 bg-danger-soft", icon: <ShieldAlert size={16} className="text-danger" aria-hidden /> },
  warning: { box: "border-warning/40 bg-warning-soft", icon: <AlertTriangle size={16} className="text-warning" aria-hidden /> },
  info: { box: "border-success/40 bg-success-soft", icon: <CheckCircle2 size={16} className="text-success" aria-hidden /> },
};

function Alerts({ alerts }: { alerts: MonitorAlert[] }) {
  return (
    <div className="space-y-2" data-testid="monitor-alerts">
      {alerts.map((a) => (
        <div key={a.id} className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm", ALERT_STYLE[a.level].box)} data-level={a.level}>
          <span className="mt-0.5">{ALERT_STYLE[a.level].icon}</span>
          <div className="min-w-0 flex-1">
            <span className="font-medium">{a.title}</span>
            <span className="text-muted"> — {a.detail}</span>
          </div>
          {a.executionId && (
            <Link to={`/monitor/${a.executionId}`} className="shrink-0 text-xs font-medium text-accent hover:underline">
              Inspect
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

function Throughput({ buckets }: { buckets: MonitorBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const hour = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div>
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label="Executions per hour over the last 24 hours">
        {buckets.map((b) => (
          <div
            key={b.bucket_start}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${hour(b.bucket_start)}: ${b.total} run(s)`}
          >
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${(b.total / max) * 100}%` }}>
              {OUTCOMES.map((o) => b[o] > 0 && <div key={o} className={OUTCOME_STYLE[o].bar} style={{ flexGrow: b[o] }} />)}
              {b.total - OUTCOMES.reduce((n, o) => n + b[o], 0) > 0 && (
                <div className="bg-border" style={{ flexGrow: b.total - OUTCOMES.reduce((n, o) => n + b[o], 0) }} />
              )}
            </div>
            {b.total === 0 && <div className="h-px w-full bg-border" />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
        <span>{hour(buckets[0].bucket_start)}</span>
        <span>{hour(buckets[Math.floor(buckets.length / 2)].bucket_start)}</span>
        <span>now</span>
      </div>
    </div>
  );
}

function OutcomeBars({ s }: { s: MonitorSummary }) {
  const total = OUTCOMES.reduce((n, o) => n + s.outcomes[o], 0);
  return (
    <div className="space-y-3">
      {OUTCOMES.map((o) => (
        <div key={o} data-testid={`outcome-${o}`}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium">{OUTCOME_STYLE[o].label}</span>
            <span className="font-mono text-muted">
              {s.outcomes[o]} · {total ? formatPercent(s.outcomes[o] / total) : "—"}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface">
            <div className={cn("h-full rounded-full", OUTCOME_STYLE[o].bar)} style={{ width: `${total ? (s.outcomes[o] / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted">
        {total} finished run{total === 1 ? "" : "s"}. Auto-resolution rate {formatPercent(s.rates.auto_resolution_rate)}.
      </p>
    </div>
  );
}

function Funnel({ stages }: { stages: MonitorSummary["stages"] }) {
  const top = Math.max(1, stages[0]?.reached ?? 1);
  return (
    <ol className="space-y-2" aria-label="Pipeline stage funnel">
      {stages.map((st) => (
        <li key={st.stage} data-testid={`stage-${st.stage}`}>
          <div className="mb-0.5 flex justify-between text-xs">
            <span className="font-medium">{st.label}</span>
            <span className="font-mono text-muted">
              {st.reached} · {formatPercent(st.reached / top)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(st.reached / top) * 100}%`, opacity: 0.35 + 0.65 * (st.reached / top) }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function AgentTable({ agents }: { agents: MonitorSummary["agents"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border">
            <th className="py-1.5 pr-3 font-medium">Agent</th>
            <th className="py-1.5 pr-3 font-medium">Runs</th>
            <th className="py-1.5 pr-3 font-medium">Success</th>
            <th className="py-1.5 pr-3 font-medium">Avg</th>
            <th className="py-1.5 font-medium">p95</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const healthy = a.success_rate === null || a.success_rate >= 0.95;
            return (
              <tr key={a.agent_id} className="border-b border-border last:border-0" data-testid={`agent-row-${a.agent_id}`}>
                <td className="py-1.5 pr-3 font-medium">
                  <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", healthy ? "bg-success" : "bg-accent live-dot")} aria-hidden />
                  {humanize(a.agent_id)}
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs">{a.runs}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{formatPercent(a.success_rate)}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{formatDuration(a.avg_duration_ms)}</td>
                <td className="py-1.5 font-mono text-xs">{formatDuration(a.p95_duration_ms)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function WorkflowMonitor() {
  const conn = useConnection();
  const [paused, setPaused] = useState(false);
  const summary = useApi(api.monitorSummary, [], { pollMs: paused ? undefined : POLL_MS });
  const s = summary.data;
  const alerts = s ? deriveAlerts(s) : [];
  const synthetic = conn.mode === "synthetic";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Workflow Monitor</h1>
          <p className="text-sm text-muted">Fleet-level health of every procurement workflow: throughput, outcomes, agent latency and pending approvals.</p>
        </div>
        {s && (
          <span className="flex items-center gap-1.5 text-xs text-muted" data-testid="monitor-updated">
            <span className={cn("h-2 w-2 rounded-full", paused ? "bg-border" : "live-dot bg-accent")} aria-hidden />
            {paused ? "Paused" : `Live · every ${POLL_MS / 1000}s`} · updated {formatTime(s.generated_at)}
          </span>
        )}
        <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? "Resume" : "Pause"}
        </Button>
        {synthetic ? (
          <Button
            size="sm"
            data-testid="generate-load"
            onClick={() => {
              getSyntheticStore().generateLoad(LOAD_SAMPLES);
              summary.reload();
            }}
          >
            <Zap size={14} /> Generate synthetic load
          </Button>
        ) : (
          <Link to="/monitor">
            <Button size="sm">
              <Play size={14} /> Run a request
            </Button>
          </Link>
        )}
      </div>

      {summary.error && !s && <ErrorBanner title="Could not load monitor" message={summary.error.message} />}
      {summary.loading && !s && <Loading label="Loading monitor…" />}

      {s && (
        <>
          <Alerts alerts={alerts} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi icon={<Activity size={14} />} label="Total runs" value={s.totals.executions} sub={`${s.totals.completed} completed · ${s.totals.failed} failed`} />
            <Kpi
              icon={<Clock size={14} />}
              label="In flight"
              value={s.totals.running + s.totals.waiting_for_approval}
              sub={`${s.totals.running} running · ${s.totals.waiting_for_approval} awaiting approval`}
              tone={s.totals.waiting_for_approval > 0 ? "accent" : "default"}
            />
            <Kpi icon={<CheckCircle2 size={14} />} label="Approval rate" value={formatPercent(s.rates.approval_rate)} sub={`${s.outcomes.approved} approved · ${s.outcomes.rejected} rejected`} />
            <Kpi icon={<Zap size={14} />} label="Automated run time" value={formatDuration(s.duration_ms.avg)} sub={`p50 ${formatDuration(s.duration_ms.p50)} · p95 ${formatDuration(s.duration_ms.p95)}`} />
            <Kpi
              icon={<ShieldAlert size={14} />}
              label="Failure rate"
              value={formatPercent(s.rates.failure_rate)}
              sub={`Approval wait avg ${formatDuration(s.approval_wait_ms.avg)}`}
              tone={(s.rates.failure_rate ?? 0) > 0 ? "danger" : "default"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Throughput · last 24 hours</CardTitle>
                <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                  {OUTCOMES.map((o) => (
                    <span key={o} className="flex items-center gap-1">
                      <span className={cn("h-2 w-2 rounded-sm", OUTCOME_STYLE[o].bar)} /> {OUTCOME_STYLE[o].label}
                    </span>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <Throughput buckets={s.throughput} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Outcomes</CardTitle>
              </CardHeader>
              <CardContent>
                <OutcomeBars s={s} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Pipeline funnel</CardTitle>
                <span className="text-xs text-muted">runs reaching each stage</span>
              </CardHeader>
              <CardContent>
                <Funnel stages={s.stages} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Agent health</CardTitle>
                <span className="text-xs text-muted">success rate &amp; latency</span>
              </CardHeader>
              <CardContent>
                <AgentTable agents={s.agents} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Pending approvals</CardTitle>
                <Badge tone={s.pending_approvals.length ? "warning" : "neutral"}>{s.pending_approvals.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1" data-testid="pending-approvals">
                {!s.pending_approvals.length ? (
                  <p className="text-sm text-muted">Nothing is waiting for a human.</p>
                ) : (
                  s.pending_approvals.map((p) => (
                    <Link key={p.approval_id} to={`/monitor/${p.execution_id}`} className="block rounded-md px-2 py-1.5 hover:bg-surface">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{formatINR(p.requested_amount)}</span>
                        <span className="text-xs text-warning">waiting {formatAge(p.age_seconds)}</span>
                      </div>
                      <div className="truncate text-xs text-muted">
                        {p.department} · {p.product ? humanize(p.product) : "—"} · {p.vendor}
                      </div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Active runs</CardTitle>
                <Badge tone={s.active.length ? "accent" : "neutral"}>{s.active.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1" data-testid="active-runs">
                {!s.active.length ? (
                  <p className="text-sm text-muted">No runs in flight.</p>
                ) : (
                  s.active.map((r) => (
                    <Link key={r.id} to={`/monitor/${r.id}`} className="block rounded-md px-2 py-1.5 hover:bg-surface">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={r.status} />
                        <span className="ml-auto text-xs text-muted">{r.current_stage ? humanize(r.current_stage) : "—"}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs">{r.raw_request}</div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent failures</CardTitle>
                <Badge tone={s.recent_failures.length ? "danger" : "neutral"}>{s.recent_failures.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1" data-testid="recent-failures">
                {!s.recent_failures.length ? (
                  <p className="text-sm text-muted">No failed executions.</p>
                ) : (
                  s.recent_failures.map((f) => (
                    <Link key={f.execution_id} to={`/monitor/${f.execution_id}`} className="block rounded-md px-2 py-1.5 hover:bg-surface">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs font-medium text-danger">{f.error_class}</span>
                        {f.retryable && <Badge>retryable</Badge>}
                        <span className="ml-auto text-xs text-muted">{formatTime(f.at)}</span>
                      </div>
                      <div className="truncate text-xs text-muted">
                        {f.agent_id ? humanize(f.agent_id) : "Orchestrator"}: {f.message}
                      </div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

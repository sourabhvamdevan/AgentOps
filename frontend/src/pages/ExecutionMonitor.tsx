import { Play, RotateCcw } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { AgentPipeline } from "../components/AgentPipeline";
import { ApprovalPanel } from "../components/ApprovalPanel";
import { AGENT_LABELS } from "../components/eventSummary";
import { EventTimeline } from "../components/EventTimeline";
import { JsonViewer } from "../components/JsonViewer";
import { ModeBadge } from "../components/ModeBadge";
import { Empty, ErrorBanner, Loading } from "../components/PageState";
import { ReportView } from "../components/ReportView";
import { AgentStatusBadge, OutcomeBadge, StatusBadge } from "../components/StatusBadge";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { useApi } from "../hooks/useApi";
import { useConnection } from "../hooks/useConnection";
import { useExecution } from "../hooks/useExecution";
import { useHealth } from "../hooks/useHealth";
import { cn, formatDateTime, formatTime, humanize } from "../lib/utils";
import { api } from "../services/api";
import type { AgentId } from "../types";
import { deriveAgentStatuses, deriveHumanStep } from "./monitorState";

export const SAMPLE_REQUEST = "Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.";

export const SAMPLES: { label: string; hint: string; text: string }[] = [
  { label: "Engineering laptops", hint: "Over ₹5L → human approval (approve or reject)", text: SAMPLE_REQUEST },
  { label: "Finance monitors", hint: "Within thresholds → auto-approved", text: "Buy 2 monitors for the Finance department with a maximum budget of ₹50,000." },
  { label: "20 laptops", hint: "Exceeds department budget → auto-rejected", text: "Purchase 20 laptops for the engineering department with a maximum budget of ₹20,00,000." },
  { label: "Marketing laptops", hint: "No vendor within max budget → auto-rejected", text: "Purchase 5 laptops for the marketing department with a maximum budget of ₹1,00,000." },
  { label: "Vague request", hint: "Cannot be parsed → failed validation", text: "buy some stuff" },
];

/** Only offered when the synthetic engine is active: it injects a retryable tool timeout into the Vendor Agent. */
export const FAILURE_SAMPLE = {
  label: "Simulate agent failure",
  hint: "Synthetic engine only: injects a tool timeout into the Vendor Agent",
  text: "Purchase 4 laptops for the HR department with a maximum budget of ₹4,00,000. simulate failure",
};

type Selection = { kind: "event"; sequence: number } | { kind: "agent"; agentId: AgentId } | null;

function RequestForm() {
  const navigate = useNavigate();
  const [text, setText] = useState(SAMPLE_REQUEST);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conn = useConnection();
  const samples = conn.mode === "synthetic" ? [...SAMPLES, FAILURE_SAMPLE] : SAMPLES;

  const run = async (value: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const ex = await api.createExecution(value.trim(), crypto.randomUUID?.());
      navigate(`/monitor/${ex.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(text);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchase request</CardTitle>
        <span className="text-xs text-muted">10–500 characters</span>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Purchase request" maxLength={500} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={submitting || text.trim().length < 10} data-testid="run-button">
              <Play size={14} /> {submitting ? "Starting…" : "Run"}
            </Button>
            <span className="text-xs text-muted">Samples:</span>
            {samples.map((s) => (
              <Button
                key={s.label}
                size="sm"
                variant="outline"
                title={s.hint}
                disabled={submitting}
                onClick={() => {
                  setText(s.text);
                  void run(s.text);
                }}
              >
                {s.label}
              </Button>
            ))}
          </div>
          {error && <ErrorBanner title="Could not start execution" message={error} />}
        </form>
      </CardContent>
    </Card>
  );
}

function RecentExecutions({ currentId, refreshKey, resetEnabled }: { currentId?: string; refreshKey?: string; resetEnabled: boolean }) {
  const navigate = useNavigate();
  const recent = useApi(() => api.executions(8, 0), [currentId, refreshKey]);
  const [confirming, setConfirming] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const reset = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    try {
      await api.resetDemo();
      navigate("/monitor");
      recent.reload();
    } catch (e) {
      setResetError((e as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent executions</CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={recent.reload} aria-label="Refresh list">
            <RotateCcw size={14} />
          </Button>
          {resetEnabled && (
            <Button size="sm" variant={confirming ? "danger" : "outline"} onClick={reset} onBlur={() => setConfirming(false)}>
              {confirming ? "Click to confirm" : "Reset demo"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {resetError && <ErrorBanner message={resetError} />}
        {recent.loading && !recent.data ? (
          <Loading />
        ) : recent.error ? (
          <ErrorBanner message={recent.error.message} />
        ) : !recent.data?.items.length ? (
          <p className="text-sm text-muted">No executions yet.</p>
        ) : (
          recent.data.items.map((ex) => (
            <Link
              key={ex.id}
              to={`/monitor/${ex.id}`}
              className={cn("block rounded-md px-2 py-1.5 hover:bg-surface", ex.id === currentId && "bg-accent-soft")}
            >
              <div className="flex items-center gap-2">
                <StatusBadge status={ex.status} />
                <span className="ml-auto text-xs text-muted">{formatTime(ex.created_at)}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-fg">{ex.raw_request}</div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Inspector({
  selection,
  view,
}: {
  selection: Selection;
  view: ReturnType<typeof useExecution>;
}) {
  if (!selection) return <p className="text-sm text-muted">Click an event or an agent to inspect its data.</p>;
  if (selection.kind === "event") {
    const ev = view.events.find((e) => e.sequence === selection.sequence);
    if (!ev) return null;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">#{ev.sequence} {humanize(ev.event_type)}</span>
          {ev.agent_id && <Badge>{AGENT_LABELS[ev.agent_id] ?? ev.agent_id}</Badge>}
          <span className="text-xs text-muted">{formatDateTime(ev.timestamp)}</span>
        </div>
        <JsonViewer value={ev.data} />
      </div>
    );
  }
  const runs = view.detail?.agent_executions.filter((a) => a.agent_id === selection.agentId) ?? [];
  const run = runs[runs.length - 1];
  if (!run) return <p className="text-sm text-muted">{AGENT_LABELS[selection.agentId]} has not run in this execution.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{AGENT_LABELS[run.agent_id]}</span>
        <AgentStatusBadge status={run.status} />
        <span className="text-xs text-muted">
          attempt {run.attempt} · {run.duration_ms ?? "—"} ms
        </span>
      </div>
      <JsonViewer label="Input" value={run.input} />
      {run.output !== null && <JsonViewer label="Output" value={run.output} />}
      {run.error && <JsonViewer label="Error" value={run.error} />}
    </div>
  );
}

export function ExecutionMonitor() {
  const { executionId = null } = useParams();
  const health = useHealth();
  const view = useExecution(executionId);
  const [selection, setSelection] = useState<Selection>(null);
  const { detail, events } = view;

  const statuses = useMemo(() => deriveAgentStatuses(events, detail), [events, detail]);
  const human = useMemo(() => deriveHumanStep(events, detail), [events, detail]);
  const pendingApproval = detail?.status === "waiting_for_approval" && detail.approval?.status === "pending" ? detail.approval : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Execution Monitor</h1>
        {health.data && !detail && <ModeBadge mode={health.data.execution_mode} model={health.data.llm_model} />}
      </div>

      <RequestForm />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {!executionId ? (
            <Empty>Run a request or pick a recent execution to watch it here.</Empty>
          ) : view.loading && !detail ? (
            <Loading label="Loading execution…" />
          ) : view.error && !detail ? (
            <ErrorBanner title="Could not load execution" message={view.error.message} />
          ) : detail ? (
            <>
              <Card>
                <CardContent className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={detail.status} />
                    <OutcomeBadge outcome={detail.outcome} />
                    <ModeBadge mode={detail.execution_mode} model={health.data?.llm_model} />
                    <span className="ml-auto text-xs text-muted" data-testid="stream-state">
                      stream: {view.stream}
                    </span>
                  </div>
                  <p className="text-sm text-fg">“{detail.raw_request}”</p>
                  <AgentPipeline
                    statuses={statuses}
                    human={human}
                    selected={selection?.kind === "agent" ? selection.agentId : null}
                    onSelect={(agentId) => setSelection({ kind: "agent", agentId })}
                  />
                </CardContent>
              </Card>

              {detail.status === "failed" && detail.error && (
                <ErrorBanner
                  title={`Execution failed${detail.error.agent_id ? ` in ${AGENT_LABELS[detail.error.agent_id] ?? detail.error.agent_id}` : ""}`}
                  errorClass={detail.error.class}
                  message={detail.error.message}
                />
              )}

              {pendingApproval && (
                <ApprovalPanel
                  approval={pendingApproval}
                  onDecide={async (decision, comment) => {
                    await api.decide(pendingApproval.id, decision, comment);
                    await view.refresh();
                  }}
                />
              )}

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Timeline</CardTitle>
                    <span className="text-xs text-muted">{events.length} persisted events</span>
                  </CardHeader>
                  <CardContent className="max-h-[560px] overflow-y-auto px-2">
                    <EventTimeline
                      events={events}
                      selectedSequence={selection?.kind === "event" ? selection.sequence : null}
                      onSelect={(e) => setSelection({ kind: "event", sequence: e.sequence })}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Inspector</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Inspector selection={selection} view={view} />
                  </CardContent>
                </Card>
              </div>

              {detail.report && <ReportView report={detail.report} />}
            </>
          ) : null}
        </div>
        <RecentExecutions currentId={executionId ?? undefined} refreshKey={detail?.status} resetEnabled={!!health.data?.demo_reset_enabled} />
      </div>
    </div>
  );
}

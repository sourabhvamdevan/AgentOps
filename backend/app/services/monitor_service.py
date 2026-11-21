"""Workflow Monitor aggregates (GET /monitor/summary). Mirrors frontend/src/synthetic/monitor.ts."""
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.registry import AGENT_ORDER
from app.api.serializers import execution_summary
from app.database.models import AgentExecution, ApprovalRequest, WorkflowExecution

BUCKETS = 24
OUTCOMES = ("approved", "rejected", "failed_validation", "error")
STAGES = [
    ("submitted", "Submitted"),
    ("request_agent", "Request Agent"),
    ("vendor_agent", "Vendor Agent"),
    ("budget_agent", "Budget Agent"),
    ("approval_agent", "Approval Agent"),
    ("human_review", "Human Review"),
    ("finalized", "Finalized"),
]


def _avg(xs: list[float]) -> int | None:
    return round(sum(xs) / len(xs)) if xs else None


def _percentile(xs: list[float], p: float) -> float | None:
    """Nearest-rank percentile."""
    if not xs:
        return None
    s = sorted(xs)
    idx = min(len(s) - 1, max(0, math.ceil(p / 100 * len(s)) - 1))
    return s[idx]


def _ratio(num: int, den: int) -> float | None:
    return round(num / den, 3) if den else None


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def _ms(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() * 1000


def build_summary(s: Session, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    execs = list(s.scalars(select(WorkflowExecution).order_by(WorkflowExecution.created_at.desc())))
    agent_rows = list(s.scalars(select(AgentExecution)))
    approvals = {a.execution_id: a for a in s.scalars(select(ApprovalRequest))}
    by_exec: dict[str, set[str]] = {}
    for a in agent_rows:
        by_exec.setdefault(a.execution_id, set()).add(a.agent_id)

    def count(status: str) -> int:
        return sum(1 for e in execs if e.status == status)

    totals = {
        "executions": len(execs),
        "running": count("running") + count("created"),
        "waiting_for_approval": count("waiting_for_approval"),
        "completed": count("completed"),
        "failed": count("failed"),
    }
    outcomes = {o: sum(1 for e in execs if e.outcome == o) for o in OUTCOMES}
    terminal = totals["completed"] + totals["failed"]
    decided = outcomes["approved"] + outcomes["rejected"]
    completed = [e for e in execs if e.status == "completed"]
    auto = [e for e in completed if e.id not in approvals]

    durations = [
        _ms(e.created_at, e.completed_at)
        for e in execs
        if e.status in ("completed", "failed") and e.id not in approvals and e.completed_at
    ]
    durations = [d for d in durations if d >= 0]
    waits = [_ms(a.requested_at, a.decided_at) for a in approvals.values() if a.decided_at]
    waits = [w for w in waits if w >= 0]

    agents = []
    for agent_id in AGENT_ORDER:
        rows = [a for a in agent_rows if a.agent_id == agent_id]
        done = [a for a in rows if a.status == "completed"]
        failed = [a for a in rows if a.status == "failed"]
        ds = [a.duration_ms for a in done + failed if a.duration_ms is not None]
        agents.append(
            {
                "agent_id": agent_id,
                "runs": len(rows),
                "completed": len(done),
                "failed": len(failed),
                "success_rate": _ratio(len(done), len(done) + len(failed)),
                "avg_duration_ms": _avg(ds),
                "p95_duration_ms": _percentile(ds, 95),
            }
        )

    def reached(stage: str) -> int:
        if stage == "submitted":
            return len(execs)
        if stage == "human_review":
            return len(approvals)
        if stage == "finalized":
            return len(completed)
        return sum(1 for e in execs if stage in by_exec.get(e.id, set()))

    stages = [{"stage": k, "label": label, "reached": reached(k)} for k, label in STAGES]

    end_hour = now.replace(minute=0, second=0, microsecond=0)
    throughput = [
        {"bucket_start": _iso(end_hour - timedelta(hours=BUCKETS - 1 - i)), "total": 0, **{o: 0 for o in OUTCOMES}}
        for i in range(BUCKETS)
    ]
    for e in execs:
        hours_back = int((end_hour - e.created_at.replace(minute=0, second=0, microsecond=0)).total_seconds() // 3600)
        idx = BUCKETS - 1 - hours_back
        if 0 <= idx < BUCKETS:
            throughput[idx]["total"] += 1
            if e.outcome in OUTCOMES:
                throughput[idx][e.outcome] += 1

    pending = []
    for e in execs:
        a = approvals.get(e.id)
        if a and a.status == "pending":
            summ = a.summary_json or {}
            pending.append(
                {
                    "approval_id": a.id,
                    "execution_id": e.id,
                    "requested_at": _iso(a.requested_at),
                    "age_seconds": max(0, round((now - a.requested_at).total_seconds())),
                    "requested_amount": summ.get("requested_amount"),
                    "department": summ.get("department"),
                    "product": summ.get("product"),
                    "vendor": (summ.get("vendor") or {}).get("name"),
                }
            )
    pending.sort(key=lambda p: -p["age_seconds"])

    failures = [
        {
            "execution_id": e.id,
            "at": _iso(e.completed_at),
            "agent_id": e.error_json.get("agent_id"),
            "error_class": e.error_json.get("class"),
            "message": e.error_json.get("message"),
            "retryable": bool(e.error_json.get("retryable")),
        }
        for e in execs
        if e.status == "failed" and e.error_json
    ][:5]

    active = [execution_summary(e) for e in execs if e.status in ("created", "running", "waiting_for_approval")][:10]

    return {
        "generated_at": _iso(now),
        "data_source": "synthetic",
        "totals": totals,
        "outcomes": outcomes,
        "rates": {
            "completion_rate": _ratio(totals["completed"], terminal),
            "failure_rate": _ratio(totals["failed"], terminal),
            "approval_rate": _ratio(outcomes["approved"], decided),
            "auto_resolution_rate": _ratio(len(auto), len(completed)),
        },
        "duration_ms": {"avg": _avg(durations), "p50": _percentile(durations, 50), "p95": _percentile(durations, 95)},
        "approval_wait_ms": {"avg": _avg(waits), "max": max(waits) if waits else None},
        "agents": agents,
        "stages": stages,
        "throughput": throughput,
        "pending_approvals": pending,
        "recent_failures": failures,
        "active": active,
    }

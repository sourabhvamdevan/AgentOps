"""Turn ORM rows into API payloads."""
from typing import Any

from app.agents.registry import AGENT_ORDER
from app.database import repositories as repo
from app.database.models import AgentExecution, ApprovalRequest, WorkflowExecution
from app.events.publisher import event_to_dict
from app.schemas.api import TERMINAL_STATUSES, ApprovalOut, ExecutionSummary

AGENT_RESULT_KEYS = {
    "request_agent": "parsed_request",
    "vendor_agent": "vendor_evaluation",
    "budget_agent": "budget_validation",
    "approval_agent": "approval_assessment",
}


def execution_summary(ex: WorkflowExecution) -> dict[str, Any]:
    return ExecutionSummary(
        id=ex.id,
        status=ex.status,
        execution_mode=ex.execution_mode,
        raw_request=ex.raw_request,
        current_stage=ex.current_stage,
        outcome=ex.outcome,
        created_at=ex.created_at,
        updated_at=ex.updated_at,
        completed_at=ex.completed_at,
    ).model_dump(mode="json")


def approval_out(a: ApprovalRequest) -> dict[str, Any]:
    return ApprovalOut(
        id=a.id,
        execution_id=a.execution_id,
        status=a.status,
        summary=a.summary_json,
        decision_comment=a.decision_comment,
        requested_at=a.requested_at,
        decided_at=a.decided_at,
    ).model_dump(mode="json")


def agent_execution_out(a: AgentExecution) -> dict[str, Any]:
    return {
        "id": a.id,
        "agent_id": a.agent_id,
        "status": a.status,
        "input": a.input_json,
        "output": a.output_json,
        "error": a.error_json,
        "attempt": a.attempt,
        "started_at": a.started_at.isoformat() if a.started_at else None,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None,
        "duration_ms": a.duration_ms,
    }


def execution_detail(s, ex: WorkflowExecution) -> dict[str, Any]:
    agents = repo.list_agent_executions(s, ex.id)
    latest = {a.agent_id: a for a in agents}  # ordered by start time; last wins
    terminal = ex.status in TERMINAL_STATUSES
    statuses = {}
    for agent_id in AGENT_ORDER:
        row = latest.get(agent_id)
        statuses[agent_id] = row.status if row else ("skipped" if terminal else "pending")
    approval = repo.get_approval_for_execution(s, ex.id)
    report = repo.get_report(s, ex.id)
    detail = execution_summary(ex)
    detail.update(
        {
            "error": ex.error_json,
            "agent_statuses": statuses,
            "agent_executions": [agent_execution_out(a) for a in agents],
            "approval": approval_out(approval) if approval else None,
            "report": report.report_json if report else None,
        }
    )
    for agent_id, key in AGENT_RESULT_KEYS.items():
        row = latest.get(agent_id)
        detail[key] = row.output_json if row and row.status == "completed" else None
    return detail


__all__ = ["execution_summary", "execution_detail", "approval_out", "event_to_dict"]

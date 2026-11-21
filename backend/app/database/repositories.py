"""All database access goes through these functions."""
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.database.models import (
    AgentExecution,
    ApprovalRequest,
    Budget,
    ExecutionEvent,
    GeneratedReport,
    Vendor,
    WorkflowExecution,
    utcnow,
)

# ---- reference data -------------------------------------------------------


def list_vendors_for_product(s: Session, product: str) -> list[Vendor]:
    return list(s.scalars(select(Vendor).where(Vendor.product == product).order_by(Vendor.id)))


def list_products(s: Session) -> list[str]:
    return sorted(set(s.scalars(select(Vendor.product))))


def list_departments(s: Session) -> list[str]:
    return list(s.scalars(select(Budget.department).order_by(Budget.department)))


def get_budget(s: Session, department: str) -> Budget | None:
    return s.scalar(select(Budget).where(func.lower(Budget.department) == department.lower()))


# ---- executions -------------------------------------------------------------


def create_execution(s: Session, raw_request: str, mode: str, idempotency_key: str | None) -> WorkflowExecution:
    ex = WorkflowExecution(raw_request=raw_request, execution_mode=mode, status="created", idempotency_key=idempotency_key)
    s.add(ex)
    s.flush()
    return ex


def get_execution(s: Session, execution_id: str) -> WorkflowExecution | None:
    return s.get(WorkflowExecution, execution_id)


def get_execution_by_idempotency_key(s: Session, key: str) -> WorkflowExecution | None:
    return s.scalar(select(WorkflowExecution).where(WorkflowExecution.idempotency_key == key))


def list_executions(s: Session, limit: int, offset: int) -> tuple[list[WorkflowExecution], int]:
    total = s.scalar(select(func.count()).select_from(WorkflowExecution)) or 0
    rows = s.scalars(
        select(WorkflowExecution).order_by(WorkflowExecution.created_at.desc()).limit(limit).offset(offset)
    )
    return list(rows), total


def update_execution(s: Session, execution_id: str, **fields: Any) -> WorkflowExecution:
    ex = s.get(WorkflowExecution, execution_id)
    if ex is None:
        raise LookupError(execution_id)
    for k, v in fields.items():
        setattr(ex, k, v)
    ex.updated_at = utcnow()
    s.flush()
    return ex


def list_executions_with_status(s: Session, statuses: list[str]) -> list[WorkflowExecution]:
    return list(s.scalars(select(WorkflowExecution).where(WorkflowExecution.status.in_(statuses))))


# ---- agent executions ---------------------------------------------------------


def start_agent_execution(s: Session, execution_id: str, agent_id: str, input_json: dict) -> AgentExecution:
    row = AgentExecution(
        execution_id=execution_id, agent_id=agent_id, status="running", input_json=input_json, attempt=1, started_at=utcnow()
    )
    s.add(row)
    s.flush()
    return row


def update_agent_execution(s: Session, row_id: str, **fields: Any) -> AgentExecution:
    row = s.get(AgentExecution, row_id)
    for k, v in fields.items():
        setattr(row, k, v)
    s.flush()
    return row


def list_agent_executions(s: Session, execution_id: str) -> list[AgentExecution]:
    return list(
        s.scalars(
            select(AgentExecution).where(AgentExecution.execution_id == execution_id).order_by(AgentExecution.started_at)
        )
    )


# ---- events ---------------------------------------------------------------------


def next_event_sequence(s: Session, execution_id: str) -> int:
    current = s.scalar(select(func.max(ExecutionEvent.sequence)).where(ExecutionEvent.execution_id == execution_id))
    return (current or 0) + 1


def add_event(
    s: Session, execution_id: str, sequence: int, event_type: str, agent_id: str | None, data: dict, ts: datetime
) -> ExecutionEvent:
    ev = ExecutionEvent(
        execution_id=execution_id, sequence=sequence, event_type=event_type, agent_id=agent_id, data_json=data, timestamp=ts
    )
    s.add(ev)
    s.flush()
    return ev


def list_events(s: Session, execution_id: str, after_sequence: int = 0) -> list[ExecutionEvent]:
    return list(
        s.scalars(
            select(ExecutionEvent)
            .where(ExecutionEvent.execution_id == execution_id, ExecutionEvent.sequence > after_sequence)
            .order_by(ExecutionEvent.sequence)
        )
    )


# ---- approvals --------------------------------------------------------------------


def get_approval_for_execution(s: Session, execution_id: str) -> ApprovalRequest | None:
    return s.scalar(select(ApprovalRequest).where(ApprovalRequest.execution_id == execution_id))


def create_approval(s: Session, execution_id: str, summary: dict) -> ApprovalRequest:
    row = ApprovalRequest(execution_id=execution_id, status="pending", summary_json=summary, requested_at=utcnow())
    s.add(row)
    s.flush()
    return row


def get_approval(s: Session, approval_id: str) -> ApprovalRequest | None:
    return s.get(ApprovalRequest, approval_id)


def list_approvals(s: Session, status: str | None) -> list[ApprovalRequest]:
    q = select(ApprovalRequest).order_by(ApprovalRequest.requested_at.desc())
    if status:
        q = q.where(ApprovalRequest.status == status)
    return list(s.scalars(q))


def decide_approval(s: Session, approval_id: str, status: str, comment: str | None) -> ApprovalRequest | None:
    """Atomically move a pending approval to a decided state. Returns None if it was not pending."""
    result = s.execute(
        update(ApprovalRequest)
        .where(ApprovalRequest.id == approval_id, ApprovalRequest.status == "pending")
        .values(status=status, decision_comment=comment, decided_at=utcnow(), updated_at=utcnow())
    )
    if result.rowcount != 1:
        return None
    s.flush()
    row = s.get(ApprovalRequest, approval_id)
    s.refresh(row)
    return row


# ---- reports ------------------------------------------------------------------------


def upsert_report(s: Session, execution_id: str, report: dict) -> GeneratedReport:
    row = s.scalar(select(GeneratedReport).where(GeneratedReport.execution_id == execution_id))
    if row is None:
        row = GeneratedReport(execution_id=execution_id, report_json=report)
        s.add(row)
    else:
        row.report_json = report
    s.flush()
    return row


def get_report(s: Session, execution_id: str) -> GeneratedReport | None:
    return s.scalar(select(GeneratedReport).where(GeneratedReport.execution_id == execution_id))


# ---- demo reset ----------------------------------------------------------------------


def wipe_runtime_data(s: Session) -> None:
    for model in (GeneratedReport, ApprovalRequest, ExecutionEvent, AgentExecution, WorkflowExecution):
        s.execute(delete(model))

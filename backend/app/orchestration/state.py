"""Shared workflow state (Section 5.2).

Agent payloads are stored as JSON-compatible dicts (validated Pydantic dumps) so the state
serializes cleanly into the SQLite checkpointer. Agents re-validate them on read.
"""
from typing import Any, Literal, TypedDict

AgentStatus = Literal["pending", "running", "completed", "failed", "skipped"]
Outcome = Literal["approved", "rejected", "failed_validation", "error"]


class WorkflowState(TypedDict, total=False):
    execution_id: str
    raw_request: str
    execution_mode: Literal["demo", "llm"]
    parsed_request: dict[str, Any] | None  # ParsedRequest
    vendor_evaluation: dict[str, Any] | None  # VendorEvaluation
    budget_validation: dict[str, Any] | None  # BudgetValidation
    approval_assessment: dict[str, Any] | None  # ApprovalAssessment
    human_decision: dict[str, Any] | None  # HumanDecision
    current_stage: str
    agent_statuses: dict[str, AgentStatus]
    outcome: Outcome | None
    errors: list[dict[str, Any]]  # ErrorRecord
    final_report: dict[str, Any] | None  # ProcurementReport


def initial_state(execution_id: str, raw_request: str, mode: str) -> WorkflowState:
    return WorkflowState(
        execution_id=execution_id,
        raw_request=raw_request,
        execution_mode=mode,  # type: ignore[typeddict-item]
        parsed_request=None,
        vendor_evaluation=None,
        budget_validation=None,
        approval_assessment=None,
        human_decision=None,
        current_stage="created",
        agent_statuses={},
        outcome=None,
        errors=[],
        final_report=None,
    )

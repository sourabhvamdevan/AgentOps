"""Deterministic final report builder (Section 10)."""
from datetime import datetime
from typing import Any

from app.schemas.domain import (
    ApprovalAssessment,
    BudgetValidation,
    ParsedRequest,
    ProcurementReport,
    RecommendedVendor,
    ReportApproval,
    ReportBudget,
    RequestSummary,
    TimelineSummary,
    VendorEvaluation,
)

AGENT_IDS = ["request_agent", "vendor_agent", "budget_agent", "approval_agent"]


def _reason(outcome: str, parsed, budget, approval, human, error_message) -> str | None:
    if outcome == "error":
        return error_message or "The workflow failed with an internal error."
    if outcome == "failed_validation":
        return f"Request could not be validated: {parsed.reason if parsed else 'not parsed'}"
    if outcome == "rejected":
        if human and human.get("decision") == "reject":
            return "Rejected by human reviewer." + (f" Comment: {human['comment']}" if human.get("comment") else "")
        if budget and budget.status != "approved":
            return f"Auto-rejected: {budget.reason}"
        if approval:
            return f"Auto-rejected: {approval.summary}"
    if outcome == "approved":
        return "Approved by human reviewer." if human else "Auto-approved: within policy thresholds."
    return None


def build_report(
    state: dict[str, Any],
    outcome: str,
    started_at: datetime | None,
    completed_at: datetime | None,
    error_message: str | None = None,
) -> ProcurementReport:
    parsed = ParsedRequest.model_validate(state["parsed_request"]) if state.get("parsed_request") else None
    vendor = VendorEvaluation.model_validate(state["vendor_evaluation"]) if state.get("vendor_evaluation") else None
    budget = BudgetValidation.model_validate(state["budget_validation"]) if state.get("budget_validation") else None
    approval = (
        ApprovalAssessment.model_validate(state["approval_assessment"]) if state.get("approval_assessment") else None
    )
    human = state.get("human_decision")

    recommended = None
    if vendor and vendor.recommended_vendor_id:
        q = next(c for c in vendor.candidates if c.vendor_id == vendor.recommended_vendor_id)
        recommended = RecommendedVendor(
            vendor_id=q.vendor_id, name=q.name, unit_price=q.unit_price, total_price=q.total_price, delivery_days=q.delivery_days
        )

    approval_section = None
    if approval:
        decision = None
        if human:
            decision = "approved" if human["decision"] == "approve" else "rejected"
        elif outcome in ("approved", "rejected"):
            decision = outcome
        approval_section = ReportApproval(
            required=approval.approval_required,
            recommendation=approval.recommendation,
            decision=decision,
            decided_by=(human.get("decided_by") if human else "policy (automatic)") if decision else None,
            comment=human.get("comment") if human else None,
            triggered_rules=approval.triggered_rules,
        )

    statuses = state.get("agent_statuses") or {}
    return ProcurementReport(
        execution_id=state["execution_id"],
        outcome=outcome,
        execution_mode=state["execution_mode"],
        reason=_reason(outcome, parsed, budget, approval, human, error_message),
        request_summary=RequestSummary(
            department=parsed.department,
            product=parsed.product.title() if parsed.product else None,
            quantity=parsed.quantity,
            maximum_budget=parsed.maximum_budget,
        )
        if parsed
        else None,
        recommended_vendor=recommended,
        vendor_comparison=vendor.candidates if vendor else None,
        budget=ReportBudget(
            requested_amount=budget.requested_amount,
            available_budget=budget.available_budget,
            remaining_budget=budget.remaining_budget,
            status=budget.status,
        )
        if budget
        else None,
        approval=approval_section,
        timeline_summary=TimelineSummary(
            started_at=started_at,
            completed_at=completed_at,
            agents_run=sum(1 for a in AGENT_IDS if statuses.get(a) in ("completed", "failed")),
        ),
    )

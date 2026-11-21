"""Typed domain payloads exchanged between agents (Section 4)."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Vendor(_Model):
    id: str
    name: str
    product: str
    unit_price: int
    delivery_days: int
    rating: float


class ParsedRequest(_Model):
    department: str | None = None
    product: str | None = None
    quantity: int | None = None
    maximum_budget: int | None = Field(default=None, description="INR")
    status: Literal["valid", "invalid"]
    missing_fields: list[str] = []
    reason: str | None = None


class VendorQuote(_Model):
    vendor_id: str
    name: str
    unit_price: int
    total_price: int
    delivery_days: int
    rating: float
    score: float | None = None
    within_budget: bool


class VendorEvaluation(_Model):
    candidates: list[VendorQuote]
    recommended_vendor_id: str | None
    explanation: str


class BudgetValidation(_Model):
    requested_amount: int | None
    available_budget: int | None
    remaining_budget: int | None
    status: Literal["approved", "rejected", "skipped"]
    reason: str


class PolicyResult(_Model):
    approval_required: bool
    triggered_rules: list[str]


class ApprovalAssessment(_Model):
    approval_required: bool
    recommendation: Literal["approve", "reject"]
    triggered_rules: list[str]
    summary: str


class HumanDecision(_Model):
    decision: Literal["approve", "reject"]
    decided_at: datetime
    decided_by: str = "demo_user"
    comment: str | None = None


class ErrorRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    error_class: str = Field(alias="class")
    message: str
    agent_id: str | None = None
    retryable: bool = False


# ---- Agent input schemas -------------------------------------------------


class RequestAgentInput(_Model):
    raw_request: str


class VendorAgentInput(_Model):
    parsed_request: ParsedRequest


class BudgetAgentInput(_Model):
    parsed_request: ParsedRequest
    vendor_evaluation: VendorEvaluation


class ApprovalAgentInput(_Model):
    parsed_request: ParsedRequest
    vendor_evaluation: VendorEvaluation
    budget_validation: BudgetValidation


# ---- Final report --------------------------------------------------------


class RequestSummary(_Model):
    department: str | None
    product: str | None
    quantity: int | None
    maximum_budget: int | None


class RecommendedVendor(_Model):
    vendor_id: str
    name: str
    unit_price: int
    total_price: int
    delivery_days: int


class ReportBudget(_Model):
    requested_amount: int | None
    available_budget: int | None
    remaining_budget: int | None
    status: str


class ReportApproval(_Model):
    required: bool
    recommendation: str | None
    decision: str | None
    decided_by: str | None
    comment: str | None
    triggered_rules: list[str] = []


class TimelineSummary(_Model):
    started_at: datetime | None
    completed_at: datetime | None
    agents_run: int


class ProcurementReport(_Model):
    execution_id: str
    outcome: Literal["approved", "rejected", "failed_validation", "error"]
    execution_mode: Literal["demo", "llm"]
    reason: str | None = None
    request_summary: RequestSummary | None
    recommended_vendor: RecommendedVendor | None
    vendor_comparison: list[VendorQuote] | None
    budget: ReportBudget | None
    approval: ReportApproval | None
    timeline_summary: TimelineSummary
    data_source: str = "synthetic"
    disclaimer: str = "All data is fictional. No real purchase was made."

"""Approval policy evaluation (Section 4.4)."""
from pydantic import BaseModel, Field

from app.config.policy import HUMAN_APPROVAL_THRESHOLD_INR, LOW_REMAINING_BUDGET_RATIO
from app.schemas.domain import PolicyResult

RULE_AMOUNT_ABOVE_THRESHOLD = "amount_above_human_approval_threshold"
RULE_LOW_REMAINING_BUDGET = "low_remaining_budget"


class EvaluatePolicyArgs(BaseModel):
    requested_amount: int = Field(ge=0)
    available_budget: int = Field(ge=0)
    remaining_budget: int


def evaluate_policy(args: EvaluatePolicyArgs) -> PolicyResult:
    rules: list[str] = []
    if args.requested_amount > HUMAN_APPROVAL_THRESHOLD_INR:
        rules.append(RULE_AMOUNT_ABOVE_THRESHOLD)
    if args.available_budget > 0 and args.remaining_budget < LOW_REMAINING_BUDGET_RATIO * args.available_budget:
        rules.append(RULE_LOW_REMAINING_BUDGET)
    return PolicyResult(approval_required=bool(rules), triggered_rules=rules)

import json

from app.agents.base import AgentContext, BaseAgent
from app.agents.vendor_agent import _inr
from app.config.policy import HUMAN_APPROVAL_THRESHOLD_INR, LOW_REMAINING_BUDGET_RATIO
from app.schemas.domain import ApprovalAgentInput, ApprovalAssessment

SUMMARY_PROMPT = (
    "You write a 1-2 sentence summary of an approval assessment for a procurement report. Use only the facts in "
    "the JSON; do not change the decision or compute new numbers."
)


class ApprovalAgent(BaseAgent):
    id = "approval_agent"
    name = "Approval Agent"
    description = "Applies approval policy and recommends approve/reject; decides whether a human must review."
    responsibilities = [
        f"Require human approval for amounts above {_inr(HUMAN_APPROVAL_THRESHOLD_INR)}",
        f"Require human approval when less than {int(LOW_REMAINING_BUDGET_RATIO * 100)}% of the budget would remain",
        "Auto-reject when budget validation was rejected or skipped",
        "Recommend only; a human decision is final when review is required",
    ]
    input_schema = ApprovalAgentInput
    output_schema = ApprovalAssessment
    tools = ["evaluate_policy"]
    uses_llm_for = "Summary prose only in llm mode; policy rules are deterministic Python"

    async def run(self, agent_input: ApprovalAgentInput, ctx: AgentContext) -> ApprovalAssessment:
        budget = agent_input.budget_validation
        if budget.status != "approved":
            rule = "budget_rejected" if budget.status == "rejected" else "no_eligible_vendor"
            assessment = ApprovalAssessment(
                approval_required=False,
                recommendation="reject",
                triggered_rules=[rule],
                summary=f"Automatically rejected: {budget.reason}",
            )
        else:
            policy = await ctx.call_tool(
                "evaluate_policy",
                requested_amount=budget.requested_amount,
                available_budget=budget.available_budget,
                remaining_budget=budget.remaining_budget,
            )
            if policy.approval_required:
                summary = (
                    f"Recommend approval of {_inr(budget.requested_amount)}; human review required by policy "
                    f"({', '.join(policy.triggered_rules)})."
                )
            else:
                summary = f"{_inr(budget.requested_amount)} is within all policy thresholds; auto-approval recommended."
            assessment = ApprovalAssessment(
                approval_required=policy.approval_required,
                recommendation="approve",
                triggered_rules=policy.triggered_rules,
                summary=summary,
            )
        if ctx.execution_mode == "llm":
            facts = assessment.model_dump(exclude={"summary"}) | {"budget": budget.model_dump()}
            assessment.summary = await ctx.require_llm().chat_text(SUMMARY_PROMPT, json.dumps(facts))
        return assessment

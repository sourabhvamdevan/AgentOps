from app.agents.base import AgentContext, BaseAgent
from app.agents.vendor_agent import _inr
from app.schemas.domain import BudgetAgentInput, BudgetValidation


class BudgetAgent(BaseAgent):
    id = "budget_agent"
    name = "Budget Agent"
    description = "Validates the recommended vendor's cost against the department budget and the request's maximum."
    responsibilities = [
        "Look up the department's available budget",
        "Check the requested amount against the available budget and the maximum budget",
        "Compute the remaining budget",
        "Skip validation when no vendor was recommended",
    ]
    input_schema = BudgetAgentInput
    output_schema = BudgetValidation
    tools = ["get_department_budget", "calculate_budget_check"]
    uses_llm_for = "Nothing; pure Python in both modes"

    async def run(self, agent_input: BudgetAgentInput, ctx: AgentContext) -> BudgetValidation:
        req, ev = agent_input.parsed_request, agent_input.vendor_evaluation
        budget = await ctx.call_tool("get_department_budget", department=req.department)
        if ev.recommended_vendor_id is None:
            return BudgetValidation(
                requested_amount=None,
                available_budget=budget.available_budget,
                remaining_budget=None,
                status="skipped",
                reason="No vendor was eligible within the maximum budget, so there is no amount to validate.",
            )
        quote = next(q for q in ev.candidates if q.vendor_id == ev.recommended_vendor_id)
        check = await ctx.call_tool("calculate_budget_check", requested=quote.total_price, available=budget.available_budget)
        within_max = quote.total_price <= req.maximum_budget
        if check.within_budget and within_max:
            status, reason = "approved", (
                f"{_inr(check.requested)} is within the {req.department} budget of {_inr(check.available)}; "
                f"{_inr(check.remaining)} would remain."
            )
        elif not check.within_budget:
            status, reason = "rejected", (
                f"{_inr(check.requested)} exceeds the {req.department} available budget of {_inr(check.available)}."
            )
        else:
            status, reason = "rejected", (
                f"{_inr(check.requested)} exceeds the request's maximum budget of {_inr(req.maximum_budget)}."
            )
        return BudgetValidation(
            requested_amount=check.requested,
            available_budget=check.available,
            remaining_budget=check.remaining,
            status=status,
            reason=reason,
        )

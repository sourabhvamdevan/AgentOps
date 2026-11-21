import json

from app.agents.base import AgentContext, BaseAgent
from app.schemas.domain import VendorAgentInput, VendorEvaluation
from app.tools.vendor_tools import score_vendors

EXPLAIN_PROMPT = (
    "You write a short (2-3 sentence) plain-English explanation of a vendor recommendation for a procurement "
    "report. Use only the numbers given in the JSON; do not compute or invent figures."
)


def _inr(n: int) -> str:
    s = str(n)
    if len(s) <= 3:
        return "₹" + s
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return "₹" + ",".join(groups + [tail])


class VendorAgent(BaseAgent):
    id = "vendor_agent"
    name = "Vendor Agent"
    description = "Compares catalog vendors for the requested product and recommends the best eligible one."
    responsibilities = [
        "Fetch vendors for the product via the get_vendors tool",
        "Compute total price per vendor and filter to those within the maximum budget",
        "Score eligible vendors on price (60%), delivery (25%) and rating (15%)",
        "Recommend the highest-scoring vendor and explain the choice",
    ]
    input_schema = VendorAgentInput
    output_schema = VendorEvaluation
    tools = ["get_vendors"]
    uses_llm_for = "Explanation prose only in llm mode; scoring is deterministic Python"

    async def run(self, agent_input: VendorAgentInput, ctx: AgentContext) -> VendorEvaluation:
        req = agent_input.parsed_request
        vendors = await ctx.call_tool("get_vendors", product=req.product)
        quotes, recommended_id = score_vendors(vendors, req.quantity, req.maximum_budget)

        if ctx.execution_mode == "llm":
            facts = {
                "request": req.model_dump(include={"department", "product", "quantity", "maximum_budget"}),
                "recommended_vendor_id": recommended_id,
                "candidates": [q.model_dump() for q in quotes],
            }
            explanation = await ctx.require_llm().chat_text(EXPLAIN_PROMPT, json.dumps(facts))
        elif recommended_id is None:
            cheapest = min(quotes, key=lambda q: q.total_price) if quotes else None
            explanation = (
                f"No vendor can supply {req.quantity} {req.product}(s) within the maximum budget of "
                f"{_inr(req.maximum_budget)}."
                + (f" The cheapest quote is {cheapest.name} at {_inr(cheapest.total_price)}." if cheapest else "")
            )
        else:
            best = next(q for q in quotes if q.vendor_id == recommended_id)
            eligible = sum(q.within_budget for q in quotes)
            explanation = (
                f"{best.name} is recommended with the highest weighted score ({best.score:.2f}) among {eligible} "
                f"vendor(s) within budget: {_inr(best.total_price)} total ({_inr(best.unit_price)} per unit), "
                f"{best.delivery_days}-day delivery, rating {best.rating}."
            )
        return VendorEvaluation(candidates=quotes, recommended_vendor_id=recommended_id, explanation=explanation)

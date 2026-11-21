"""Tool registry and per-agent allowlist (Section 6)."""
from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.errors import ToolPermissionError, ValidationFailure
from app.tools import budget_tools, policy_tools, vendor_tools


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    func: Callable[..., Any]
    needs_session: bool


TOOLS: dict[str, ToolSpec] = {
    spec.name: spec
    for spec in [
        ToolSpec("get_vendors", "List catalog vendors for a product.", vendor_tools.GetVendorsArgs, vendor_tools.get_vendors, True),
        ToolSpec(
            "get_department_budget",
            "Look up a department's available budget.",
            budget_tools.GetDepartmentBudgetArgs,
            budget_tools.get_department_budget,
            True,
        ),
        ToolSpec(
            "calculate_budget_check",
            "Compare a requested amount against an available budget.",
            budget_tools.BudgetCheckArgs,
            budget_tools.calculate_budget_check,
            False,
        ),
        ToolSpec(
            "evaluate_policy",
            "Apply approval policy rules to a purchase amount.",
            policy_tools.EvaluatePolicyArgs,
            policy_tools.evaluate_policy,
            False,
        ),
    ]
}

AGENT_TOOL_ALLOWLIST: dict[str, list[str]] = {
    "request_agent": [],
    "vendor_agent": ["get_vendors"],
    "budget_agent": ["get_department_budget", "calculate_budget_check"],
    "approval_agent": ["evaluate_policy"],
}


def resolve_tool(agent_id: str, tool_name: str) -> ToolSpec:
    if tool_name not in AGENT_TOOL_ALLOWLIST.get(agent_id, []):
        raise ToolPermissionError(f"Agent '{agent_id}' is not allowed to call tool '{tool_name}'")
    spec = TOOLS.get(tool_name)
    if spec is None:
        raise ToolPermissionError(f"Unknown tool '{tool_name}'")
    return spec


def execute_tool(spec: ToolSpec, args: dict[str, Any], session: Session | None) -> Any:
    try:
        parsed = spec.args_model.model_validate(args)
    except ValidationError as exc:
        raise ValidationFailure(f"Invalid arguments for tool '{spec.name}'", exc.errors(include_url=False)) from exc
    return spec.func(session, parsed) if spec.needs_session else spec.func(parsed)


def to_jsonable(result: Any) -> Any:
    if isinstance(result, BaseModel):
        return result.model_dump(mode="json")
    if isinstance(result, list):
        return [to_jsonable(r) for r in result]
    return result

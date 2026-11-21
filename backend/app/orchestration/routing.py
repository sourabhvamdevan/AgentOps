"""Pure routing functions for conditional edges (Section 5.1)."""
from typing import Any, Literal


def route_after_request(state: dict[str, Any]) -> Literal["vendor_agent", "finalize"]:
    parsed = state.get("parsed_request") or {}
    return "vendor_agent" if parsed.get("status") == "valid" else "finalize"


def explain_after_request(state: dict[str, Any]) -> str:
    parsed = state.get("parsed_request") or {}
    if route_after_request(state) == "vendor_agent":
        return "Request is valid; continuing to vendor comparison."
    return f"Request is invalid ({parsed.get('reason') or 'unparseable'}); skipping to finalize with failed_validation."


def route_after_approval(state: dict[str, Any]) -> Literal["human_review", "finalize"]:
    assessment = state.get("approval_assessment") or {}
    return "human_review" if assessment.get("approval_required") else "finalize"


def explain_after_approval(state: dict[str, Any]) -> str:
    a = state.get("approval_assessment") or {}
    if route_after_approval(state) == "human_review":
        return f"Policy requires human approval ({', '.join(a.get('triggered_rules', []))})."
    return f"No human approval required; recommendation is '{a.get('recommendation')}'."


def decide_outcome(state: dict[str, Any]) -> Literal["approved", "rejected", "failed_validation"]:
    parsed = state.get("parsed_request") or {}
    if parsed.get("status") != "valid":
        return "failed_validation"
    human = state.get("human_decision")
    if human:
        return "approved" if human.get("decision") == "approve" else "rejected"
    assessment = state.get("approval_assessment") or {}
    return "approved" if assessment.get("recommendation") == "approve" else "rejected"

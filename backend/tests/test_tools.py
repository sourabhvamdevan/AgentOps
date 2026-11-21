import pytest

from app.errors import ToolPermissionError, ValidationFailure
from app.schemas.domain import Vendor
from app.tools.budget_tools import BudgetCheckArgs, calculate_budget_check
from app.tools.policy_tools import EvaluatePolicyArgs, evaluate_policy
from app.tools.registry import TOOLS, execute_tool, resolve_tool
from app.tools.vendor_tools import score_vendors

LAPTOPS = [
    Vendor(id="v1", name="NorthPeak Systems", product="laptop", unit_price=74000, delivery_days=7, rating=4.2),
    Vendor(id="v2", name="Zenvolt Technologies", product="laptop", unit_price=68500, delivery_days=12, rating=3.9),
    Vendor(id="v3", name="Corebridge Supplies", product="laptop", unit_price=82000, delivery_days=4, rating=4.7),
    Vendor(id="v4", name="Lumina Hardware", product="laptop", unit_price=91000, delivery_days=3, rating=4.5),
]


def test_scoring_10_laptops_8_lakh():
    quotes, best = score_vendors(LAPTOPS, 10, 800_000)
    by_id = {q.vendor_id: q for q in quotes}
    assert best == "v2"
    assert by_id["v2"].score == pytest.approx(0.6)
    assert by_id["v1"].score == pytest.approx(0.4)
    assert not by_id["v3"].within_budget and by_id["v3"].score is None
    assert by_id["v2"].total_price == 685_000


def test_scoring_20_laptops_all_eligible():
    _, best = score_vendors(LAPTOPS, 20, 2_000_000)
    assert best == "v1"  # 0.6485 vs v3 0.6122 vs v2 0.6


def test_scoring_none_eligible():
    quotes, best = score_vendors(LAPTOPS, 5, 100_000)
    assert best is None
    assert all(not q.within_budget for q in quotes)


def test_scoring_single_candidate_gets_full_score():
    quotes, best = score_vendors(LAPTOPS[:1], 1, 100_000)
    assert best == "v1" and quotes[0].score == pytest.approx(1.0)


def test_tie_broken_by_lower_price():
    a = Vendor(id="a", name="A", product="x", unit_price=100, delivery_days=1, rating=4.0)
    b = Vendor(id="b", name="B", product="x", unit_price=100, delivery_days=1, rating=4.0)
    _, best = score_vendors([b, a], 1, 1000)
    assert best == "a"  # identical totals fall back to vendor id


def test_budget_check():
    r = calculate_budget_check(BudgetCheckArgs(requested=685_000, available=1_200_000))
    assert r.within_budget and r.remaining == 515_000
    r = calculate_budget_check(BudgetCheckArgs(requested=1_480_000, available=1_200_000))
    assert not r.within_budget and r.remaining == -280_000


@pytest.mark.parametrize(
    "amount,available,remaining,required,rules",
    [
        (685_000, 1_200_000, 515_000, True, ["amount_above_human_approval_threshold"]),
        (500_000, 1_200_000, 700_000, False, []),
        (26_400, 600_000, 573_600, False, []),
        (240_000, 250_000, 10_000, True, ["low_remaining_budget"]),
        (590_000, 600_000, 10_000, True, ["amount_above_human_approval_threshold", "low_remaining_budget"]),
    ],
)
def test_policy(amount, available, remaining, required, rules):
    r = evaluate_policy(EvaluatePolicyArgs(requested_amount=amount, available_budget=available, remaining_budget=remaining))
    assert r.approval_required is required and r.triggered_rules == rules


def test_tool_allowlist_enforced():
    assert resolve_tool("vendor_agent", "get_vendors").name == "get_vendors"
    with pytest.raises(ToolPermissionError):
        resolve_tool("vendor_agent", "evaluate_policy")
    with pytest.raises(ToolPermissionError):
        resolve_tool("request_agent", "get_vendors")
    with pytest.raises(ToolPermissionError):
        resolve_tool("budget_agent", "rm_rf")


def test_tool_arguments_validated():
    with pytest.raises(ValidationFailure):
        execute_tool(TOOLS["calculate_budget_check"], {"requested": "lots", "available": 1}, None)

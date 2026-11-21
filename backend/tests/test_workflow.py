"""End-to-end graph runs in demo mode (Section 6.3) plus persistence, events and restart behaviour."""
import pytest
from pydantic import ValidationError

from app.agents.base import AgentContext, execute_agent
from app.agents.registry import AGENTS
from app.api.serializers import execution_detail
from app.database import repositories as repo
from app.database.models import WorkflowExecution
from app.errors import AgentFailedError
from app.main import start_stack
from app.schemas.domain import ParsedRequest

from .conftest import SCENARIOS, run_to_rest


def detail(stack, eid):
    with stack.db.session() as s:
        return execution_detail(s, repo.get_execution(s, eid))


def events(stack, eid):
    with stack.db.session() as s:
        return [(e.sequence, e.event_type, e.agent_id, e.data_json) for e in repo.list_events(s, eid)]


async def test_scenario_1_waits_for_approval(stack):
    eid = await run_to_rest(stack, SCENARIOS[1])
    d = detail(stack, eid)
    assert d["status"] == "waiting_for_approval"
    assert d["vendor_evaluation"]["recommended_vendor_id"] == "v2"
    assert d["budget_validation"] == {
        "requested_amount": 685_000,
        "available_budget": 1_200_000,
        "remaining_budget": 515_000,
        "status": "approved",
        "reason": d["budget_validation"]["reason"],
    }
    assert d["approval_assessment"]["approval_required"] is True
    assert d["approval_assessment"]["triggered_rules"] == ["amount_above_human_approval_threshold"]
    assert d["approval"]["status"] == "pending"
    assert d["approval"]["summary"]["requested_amount"] == 685_000
    assert d["report"] is None
    types = [t for _, t, _, _ in events(stack, eid)]
    assert types[-1] == "approval_requested"
    assert "workflow_completed" not in types


async def test_scenario_2_auto_approved(stack):
    eid = await run_to_rest(stack, SCENARIOS[2])
    d = detail(stack, eid)
    assert (d["status"], d["outcome"]) == ("completed", "approved")
    assert d["vendor_evaluation"]["recommended_vendor_id"] == "v6"
    assert d["budget_validation"]["requested_amount"] == 26_400
    assert d["budget_validation"]["remaining_budget"] == 573_600
    assert d["approval_assessment"]["approval_required"] is False
    assert d["approval"] is None
    report = d["report"]
    assert report["outcome"] == "approved"
    assert report["recommended_vendor"]["name"] == "Zenvolt Technologies"
    assert report["approval"]["decided_by"] == "policy (automatic)"
    assert report["timeline_summary"]["agents_run"] == 4
    assert report["disclaimer"] == "All data is fictional. No real purchase was made."
    assert [t for _, t, _, _ in events(stack, eid)] == [
        "workflow_initialized",
        "agent_started", "agent_completed", "branch_selected",
        "agent_started", "tool_invoked", "tool_completed", "agent_completed",
        "agent_started", "tool_invoked", "tool_completed", "tool_invoked", "tool_completed", "agent_completed",
        "agent_started", "tool_invoked", "tool_completed", "agent_completed", "branch_selected",
        "workflow_completed",
    ]  # fmt: skip


async def test_scenario_3_over_department_budget(stack):
    eid = await run_to_rest(stack, SCENARIOS[3])
    d = detail(stack, eid)
    assert (d["status"], d["outcome"]) == ("completed", "rejected")
    assert d["vendor_evaluation"]["recommended_vendor_id"] == "v1"
    b = d["budget_validation"]
    assert (b["status"], b["requested_amount"], b["available_budget"], b["remaining_budget"]) == (
        "rejected", 1_480_000, 1_200_000, -280_000,
    )  # fmt: skip
    assert d["approval_assessment"] == {
        "approval_required": False,
        "recommendation": "reject",
        "triggered_rules": ["budget_rejected"],
        "summary": d["approval_assessment"]["summary"],
    }
    assert d["approval"] is None


async def test_scenario_4_no_vendor_within_max(stack):
    eid = await run_to_rest(stack, SCENARIOS[4])
    d = detail(stack, eid)
    assert (d["status"], d["outcome"]) == ("completed", "rejected")
    assert d["vendor_evaluation"]["recommended_vendor_id"] is None
    assert d["budget_validation"]["status"] == "skipped"
    assert d["budget_validation"]["available_budget"] == 400_000
    assert d["approval_assessment"]["triggered_rules"] == ["no_eligible_vendor"]
    assert d["report"]["recommended_vendor"] is None
    assert "Auto-rejected" in d["report"]["reason"]


async def test_scenario_5_invalid_request(stack):
    eid = await run_to_rest(stack, SCENARIOS[5])
    d = detail(stack, eid)
    assert (d["status"], d["outcome"]) == ("completed", "failed_validation")
    assert d["parsed_request"]["status"] == "invalid"
    assert d["agent_statuses"] == {
        "request_agent": "completed",
        "vendor_agent": "skipped",
        "budget_agent": "skipped",
        "approval_agent": "skipped",
    }
    ev = events(stack, eid)
    branch = next(data for _, t, _, data in ev if t == "branch_selected")
    assert branch["branch"] == "finalize"
    assert d["report"]["outcome"] == "failed_validation"
    assert d["report"]["vendor_comparison"] is None and d["report"]["reason"]


@pytest.mark.parametrize("decision,outcome", [("reject", "rejected"), ("approve", "approved")])
async def test_scenario_1_and_6_human_decision(stack, decision, outcome):
    eid = await run_to_rest(stack, SCENARIOS[1])
    approval_id = detail(stack, eid)["approval"]["id"]
    await stack.service.decide(approval_id, decision, "checked by test")
    await stack.service.wait(eid)
    d = detail(stack, eid)
    assert (d["status"], d["outcome"]) == ("completed", outcome)
    assert d["approval"]["status"] == ("approved" if decision == "approve" else "rejected")
    assert d["report"]["approval"]["decision"] == ("approved" if decision == "approve" else "rejected")
    assert d["report"]["approval"]["comment"] == "checked by test"
    types = [t for _, t, _, _ in events(stack, eid)]
    assert types.count("approval_requested") == 1  # human_review re-runs on resume; must not duplicate
    assert types[-2:] == ["approval_received", "workflow_completed"]


async def test_double_decision_conflict(stack):
    from app.services.execution_service import Conflict

    eid = await run_to_rest(stack, SCENARIOS[1])
    approval_id = detail(stack, eid)["approval"]["id"]
    await stack.service.decide(approval_id, "approve", None)
    with pytest.raises(Conflict):
        await stack.service.decide(approval_id, "reject", None)
    await stack.service.wait(eid)
    assert detail(stack, eid)["outcome"] == "approved"


async def test_events_monotonic_and_persisted_before_publish(stack):
    seen = []
    original = stack.runtime.publisher.bus.publish

    def checking_publish(execution_id, event):
        with stack.db.session() as s:
            persisted = [e.id for e in repo.list_events(s, execution_id)]
        assert event["id"] in persisted, "event published before it was persisted"
        seen.append(event["sequence"])
        original(execution_id, event)

    stack.runtime.publisher.bus.publish = checking_publish
    eid = await run_to_rest(stack, SCENARIOS[2])
    seqs = [s for s, *_ in events(stack, eid)]
    assert seqs == list(range(1, len(seqs) + 1))
    assert seen == seqs


async def test_agent_executions_persisted(stack):
    eid = await run_to_rest(stack, SCENARIOS[2])
    d = detail(stack, eid)
    assert [a["agent_id"] for a in d["agent_executions"]] == list(AGENTS)
    for a in d["agent_executions"]:
        assert a["status"] == "completed" and a["input"] and a["output"] and a["duration_ms"] is not None


async def test_resume_after_restart(settings):
    from .conftest import FakeLLM

    first = await start_stack(settings, llm=FakeLLM())
    eid = await run_to_rest(first, SCENARIOS[1])
    approval_id = detail(first, eid)["approval"]["id"]
    seq_before = len(events(first, eid))
    await first.close()  # simulated process exit

    second = await start_stack(settings, llm=FakeLLM())  # new graph instance, same checkpoint DB
    try:
        assert detail(second, eid)["status"] == "waiting_for_approval"
        await second.service.decide(approval_id, "approve", "after restart")
        await second.service.wait(eid)
        d = detail(second, eid)
        assert (d["status"], d["outcome"]) == ("completed", "approved")
        ev = events(second, eid)
        assert [s for s, *_ in ev] == list(range(1, len(ev) + 1))
        assert len(ev) == seq_before + 2
        assert [t for _, t, _, _ in ev].count("approval_requested") == 1
    finally:
        await second.close()


async def test_running_execution_marked_failed_on_restart(settings):
    from .conftest import FakeLLM

    first = await start_stack(settings, llm=FakeLLM())
    with first.db.session() as s:
        s.add(WorkflowExecution(id="orphan", raw_request="x" * 20, execution_mode="demo", status="running"))
    await first.close()
    second = await start_stack(settings, llm=FakeLLM())
    try:
        d = detail(second, "orphan")
        assert (d["status"], d["outcome"]) == ("failed", "error")
        assert d["error"]["message"] == "interrupted by restart"
        assert events(second, "orphan")[-1][1] == "workflow_failed"
    finally:
        await second.close()


async def test_output_schema_validation_fails_agent(stack):
    class BrokenAgent(type(AGENTS["vendor_agent"])):
        async def run(self, agent_input, ctx):
            return {"candidates": "nope"}

    ctx = AgentContext("x", "vendor_agent", "demo", stack.runtime.publisher, stack.db, None, stack.settings)
    with stack.db.session() as s:
        s.add(WorkflowExecution(id="x", raw_request="x" * 20, execution_mode="demo", status="running"))
    parsed = ParsedRequest(department="HR", product="keyboard", quantity=1, maximum_budget=5000, status="valid")
    with pytest.raises(AgentFailedError) as info:
        await execute_agent(BrokenAgent(), {"parsed_request": parsed.model_dump()}, ctx)
    assert info.value.record["class"] == "ValidationError"
    assert info.value.record["retryable"] is False


async def test_tool_permission_error_fails_agent(stack):
    class SneakyAgent(type(AGENTS["request_agent"])):
        async def run(self, agent_input, ctx):
            await ctx.call_tool("get_vendors", product="laptop")

    ctx = AgentContext("y", "request_agent", "demo", stack.runtime.publisher, stack.db, None, stack.settings)
    with stack.db.session() as s:
        s.add(WorkflowExecution(id="y", raw_request="y" * 20, execution_mode="demo", status="running"))
    with pytest.raises(AgentFailedError) as info:
        await execute_agent(SneakyAgent(), {"raw_request": "whatever request"}, ctx)
    assert info.value.record["class"] == "ToolPermissionError"


def test_parsed_request_schema_rejects_bad_status():
    with pytest.raises(ValidationError):
        ParsedRequest(status="maybe")

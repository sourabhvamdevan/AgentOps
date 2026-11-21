"""GET /monitor/summary aggregates, using the same scenarios as the rest of the suite."""
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import SCENARIOS, FakeLLM
from .test_api import API, submit, wait_for


def test_empty_summary_is_well_formed(settings):
    with TestClient(create_app(settings, llm=FakeLLM(available=False))) as c:
        m = c.get(f"{API}/monitor/summary").json()
    assert m["totals"]["executions"] == 0
    assert m["rates"]["approval_rate"] is None and m["duration_ms"]["avg"] is None
    assert len(m["throughput"]) == 24
    assert [a["runs"] for a in m["agents"]] == [0, 0, 0, 0]


def test_summary_after_every_scenario(settings):
    with TestClient(create_app(settings, llm=FakeLLM(available=False))) as c:
        ids = {n: submit(c, SCENARIOS[n])["id"] for n in (1, 2, 3, 4, 5)}
        for n in (2, 3, 4, 5):
            wait_for(c, ids[n], ("completed",))
        first = wait_for(c, ids[1])
        assert first["status"] == "waiting_for_approval"

        m = c.get(f"{API}/monitor/summary").json()
        assert m["totals"] == {"executions": 5, "running": 0, "waiting_for_approval": 1, "completed": 4, "failed": 0}
        assert m["outcomes"] == {"approved": 1, "rejected": 2, "failed_validation": 1, "error": 0}
        assert m["rates"]["approval_rate"] == 0.333
        assert m["rates"]["auto_resolution_rate"] == 1.0
        assert m["rates"]["failure_rate"] == 0.0

        stages = {s["stage"]: s["reached"] for s in m["stages"]}
        assert stages["submitted"] == 5 and stages["request_agent"] == 5
        assert stages["vendor_agent"] == 4  # the vague request never reaches the vendor agent
        assert stages["human_review"] == 1 and stages["finalized"] == 4

        pending = m["pending_approvals"]
        assert len(pending) == 1 and pending[0]["requested_amount"] == 685000
        assert pending[0]["vendor"] == "Zenvolt Technologies"
        assert [a["agent_id"] for a in m["agents"]][0] == "request_agent"
        assert m["agents"][0]["success_rate"] == 1.0
        assert sum(b["total"] for b in m["throughput"]) == 5
        assert [e["id"] for e in m["active"]] == [ids[1]]


def test_decision_updates_rates_and_wait_time(settings):
    with TestClient(create_app(settings, llm=FakeLLM(available=False))) as c:
        eid = submit(c, SCENARIOS[1])["id"]
        approval = wait_for(c, eid)["approval"]
        assert c.post(f"{API}/approvals/{approval['id']}/decision", json={"decision": "approve"}).status_code == 200
        wait_for(c, eid, ("completed",))
        m = c.get(f"{API}/monitor/summary").json()
    assert m["outcomes"]["approved"] == 1 and m["pending_approvals"] == []
    assert m["approval_wait_ms"]["avg"] is not None
    assert m["duration_ms"]["avg"] is None  # human-reviewed runs are excluded from automated latency

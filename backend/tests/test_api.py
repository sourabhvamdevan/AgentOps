"""HTTP + WebSocket API tests against a real app instance (lifespan included)."""
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import SCENARIOS, FakeLLM

API = "/api/v1"


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings, llm=FakeLLM(available=False))) as c:
        yield c


def wait_for(client, eid, statuses=("completed", "failed", "waiting_for_approval"), timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        d = client.get(f"{API}/executions/{eid}").json()
        if d["status"] in statuses:
            return d
        time.sleep(0.05)
    raise AssertionError(f"execution stuck in {d['status']}")


def submit(client, text, **headers):
    r = client.post(f"{API}/executions", json={"request": text}, headers=headers)
    assert r.status_code in (200, 202), r.text
    return r.json()


def assert_error(r, status, code):
    assert r.status_code == status, r.text
    body = r.json()
    assert set(body) == {"error"} and body["error"]["code"] == code and body["error"]["message"]


def test_health(client):
    body = client.get(f"{API}/health").json()
    assert body["status"] == "ok"
    assert body["execution_mode"] == "demo"
    assert body["llm_available"] is False
    assert body["llm_model"] is None


def test_workflows_generated_from_graph(client):
    assert [w["id"] for w in client.get(f"{API}/workflows").json()["items"]] == ["procurement"]
    wf = client.get(f"{API}/workflows/procurement").json()
    ids = {n["id"] for n in wf["nodes"]}
    assert ids == {"__start__", "init", "request_agent", "vendor_agent", "budget_agent", "approval_agent", "human_review", "finalize", "__end__"}
    edges = {(e["source"], e["target"]): e["conditional"] for e in wf["edges"]}
    assert edges[("request_agent", "finalize")] is True
    assert edges[("approval_agent", "human_review")] is True
    assert edges[("vendor_agent", "budget_agent")] is False
    assert_error(client.get(f"{API}/workflows/nope"), 404, "not_found")


def test_agents(client):
    items = client.get(f"{API}/agents").json()["items"]
    assert [a["id"] for a in items] == ["request_agent", "vendor_agent", "budget_agent", "approval_agent"]
    vendor = client.get(f"{API}/agents/vendor_agent").json()
    assert vendor["tools"][0]["name"] == "get_vendors"
    assert vendor["output_schema"]["title"] == "VendorEvaluation"
    assert vendor["responsibilities"]
    assert_error(client.get(f"{API}/agents/ghost"), 404, "not_found")


def test_create_validation_errors(client):
    assert_error(client.post(f"{API}/executions", json={"request": "   short   "}), 422, "validation_error")
    assert_error(client.post(f"{API}/executions", json={"request": "x" * 501}), 422, "validation_error")
    assert_error(client.post(f"{API}/executions", json={}), 422, "validation_error")


def test_full_journey_with_approval(client):
    created = submit(client, SCENARIOS[1])
    assert created["status"] == "created" and created["execution_mode"] == "demo"
    assert created["raw_request"] == SCENARIOS[1]
    d = wait_for(client, created["id"])
    assert d["status"] == "waiting_for_approval"

    pending = client.get(f"{API}/approvals", params={"status": "pending"}).json()["items"]
    assert [a["execution_id"] for a in pending] == [created["id"]]
    approval_id = pending[0]["id"]

    r = client.post(f"{API}/approvals/{approval_id}/decision", json={"decision": "approve", "comment": "ok"})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert_error(client.post(f"{API}/approvals/{approval_id}/decision", json={"decision": "reject"}), 409, "conflict")

    d = wait_for(client, created["id"], ("completed", "failed"))
    assert (d["status"], d["outcome"]) == ("completed", "approved")
    assert d["report"]["approval"]["decision"] == "approved"

    events = client.get(f"{API}/executions/{created['id']}/events").json()["items"]
    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["event_type"] == "workflow_completed"
    tail = client.get(f"{API}/executions/{created['id']}/events", params={"after_sequence": len(events) - 2}).json()["items"]
    assert [e["sequence"] for e in tail] == [len(events) - 1, len(events)]
    assert client.get(f"{API}/approvals", params={"status": "pending"}).json()["items"] == []


def test_decision_errors(client):
    assert_error(client.post(f"{API}/approvals/missing/decision", json={"decision": "approve"}), 404, "not_found")
    assert_error(client.post(f"{API}/approvals/missing/decision", json={"decision": "maybe"}), 422, "validation_error")
    assert_error(client.get(f"{API}/executions/missing"), 404, "not_found")
    assert_error(client.get(f"{API}/executions/missing/events"), 404, "not_found")


def test_list_executions_newest_first_and_paginated(client):
    ids = [submit(client, SCENARIOS[n])["id"] for n in (2, 5, 4)]
    for eid in ids:
        wait_for(client, eid)
    page = client.get(f"{API}/executions", params={"limit": 2}).json()
    assert page["total"] == 3 and [i["id"] for i in page["items"]] == [ids[2], ids[1]]
    page2 = client.get(f"{API}/executions", params={"limit": 2, "offset": 2}).json()
    assert [i["id"] for i in page2["items"]] == [ids[0]]


def test_idempotency_key(client):
    a = submit(client, SCENARIOS[2], **{"Idempotency-Key": "abc-123"})
    r = client.post(f"{API}/executions", json={"request": SCENARIOS[3]}, headers={"Idempotency-Key": "abc-123"})
    assert r.status_code == 200 and r.json()["id"] == a["id"]
    assert r.headers["Idempotent-Replay"] == "true"
    wait_for(client, a["id"])
    assert client.get(f"{API}/executions").json()["total"] == 1


def test_rate_limit(settings):
    settings.rate_limit_executions_per_hour = 2
    with TestClient(create_app(settings, llm=FakeLLM())) as c:
        submit(c, SCENARIOS[5])
        submit(c, SCENARIOS[5])
        r = c.post(f"{API}/executions", json={"request": SCENARIOS[5]})
        assert_error(r, 429, "rate_limited")
        assert int(r.headers["Retry-After"]) > 0


def test_demo_reset(client):
    eid = submit(client, SCENARIOS[1])["id"]
    wait_for(client, eid)
    r = client.post(f"{API}/demo/reset")
    assert r.status_code == 200
    assert client.get(f"{API}/executions").json()["total"] == 0
    assert client.get(f"{API}/approvals").json()["items"] == []
    eid2 = submit(client, SCENARIOS[2])["id"]
    assert wait_for(client, eid2)["outcome"] == "approved"


def test_demo_reset_disabled(settings):
    settings.demo_reset_enabled = False
    with TestClient(create_app(settings, llm=FakeLLM())) as c:
        assert_error(c.post(f"{API}/demo/reset"), 403, "reset_disabled")


def test_websocket_replay_of_finished_execution(client):
    eid = submit(client, SCENARIOS[2])["id"]
    wait_for(client, eid)
    rest = client.get(f"{API}/executions/{eid}/events").json()["items"]
    with client.websocket_connect(f"{API}/executions/{eid}/stream") as ws:
        got = []
        while True:
            msg = ws.receive_json()
            if msg["type"] == "closed":
                break
            got.append(msg["event"])
    assert got == rest


def test_websocket_live_stream_through_approval(client):
    eid = submit(client, SCENARIOS[1])["id"]
    with client.websocket_connect(f"{API}/executions/{eid}/stream") as ws:
        seqs, types = [], []
        while "approval_requested" not in types:
            ev = ws.receive_json()["event"]
            seqs.append(ev["sequence"])
            types.append(ev["event_type"])
        approval_id = client.get(f"{API}/approvals", params={"status": "pending"}).json()["items"][0]["id"]
        client.post(f"{API}/approvals/{approval_id}/decision", json={"decision": "reject"})
        while True:
            msg = ws.receive_json()
            if msg["type"] == "closed":
                assert msg["status"] == "completed"
                break
            seqs.append(msg["event"]["sequence"])
            types.append(msg["event"]["event_type"])
    assert seqs == list(range(1, len(seqs) + 1))
    assert types[-2:] == ["approval_received", "workflow_completed"]
    assert client.get(f"{API}/executions/{eid}").json()["outcome"] == "rejected"


def test_websocket_unknown_execution(client):
    with client.websocket_connect(f"{API}/executions/nope/stream") as ws:
        assert ws.receive_json()["type"] == "error"

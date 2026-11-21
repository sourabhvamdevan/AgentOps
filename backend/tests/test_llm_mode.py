"""llm mode: model only parses text and writes prose; numbers stay deterministic. Failures are not hidden."""
import httpx
import pytest

from app.api.serializers import execution_detail
from app.database import repositories as repo
from app.errors import LLMOutputError, LLMTimeoutError
from app.main import start_stack
from app.services.llm_client import OllamaClient

from .conftest import SCENARIOS, FakeLLM, run_to_rest


@pytest.fixture
def llm_settings(settings):
    settings.execution_mode = "llm"
    return settings


def detail(stack, eid):
    with stack.db.session() as s:
        return execution_detail(s, repo.get_execution(s, eid))


async def test_llm_mode_happy_path_uses_deterministic_numbers(llm_settings):
    fake = FakeLLM(parse={"department": "engineering", "product": "Laptops", "quantity": 10, "maximum_budget": 800000})
    st = await start_stack(llm_settings, llm=fake)
    try:
        eid = await run_to_rest(st, SCENARIOS[1])
        d = detail(st, eid)
        assert d["execution_mode"] == "llm"
        assert d["status"] == "waiting_for_approval"
        assert d["parsed_request"]["department"] == "Engineering" and d["parsed_request"]["product"] == "laptop"
        assert d["vendor_evaluation"]["recommended_vendor_id"] == "v2"
        assert d["vendor_evaluation"]["explanation"] == "LLM-written explanation."
        assert d["budget_validation"]["requested_amount"] == 685_000
        assert d["approval_assessment"]["summary"] == "LLM-written explanation."
        assert fake.json_calls == 1 and fake.text_calls == 2
    finally:
        await st.close()


async def test_llm_timeout_fails_execution_after_retries(llm_settings):
    fake = FakeLLM(parse=LLMTimeoutError("LLM call timed out after 30s"))
    st = await start_stack(llm_settings, llm=fake)
    try:
        eid = await run_to_rest(st, SCENARIOS[1])
        d = detail(st, eid)
        assert (d["status"], d["outcome"]) == ("failed", "error")
        assert d["error"]["class"] == "LLMTimeoutError" and d["error"]["agent_id"] == "request_agent"
        assert d["error"]["retryable"] is True
        assert fake.json_calls == 3  # 1 attempt + 2 retries
        assert d["agent_statuses"]["request_agent"] == "failed"
        assert d["agent_executions"][0]["attempt"] == 3
        assert d["report"]["outcome"] == "error" and "LLMTimeoutError" in d["report"]["reason"]
        with st.db.session() as s:
            types = [e.event_type for e in repo.list_events(s, eid)]
        assert types[-2:] == ["agent_failed", "workflow_failed"]
        assert "workflow_completed" not in types
    finally:
        await st.close()


async def test_llm_bad_output_is_not_retried_and_not_hidden(llm_settings):
    fake = FakeLLM(parse=LLMOutputError("LLM output was not valid JSON"))
    st = await start_stack(llm_settings, llm=fake)
    try:
        d = detail(st, await run_to_rest(st, SCENARIOS[1]))
        assert d["status"] == "failed" and d["error"]["class"] == "LLMOutputError"
        assert fake.json_calls == 1
    finally:
        await st.close()


async def test_llm_wrong_field_types(llm_settings):
    fake = FakeLLM(parse={"department": "HR", "product": "keyboard", "quantity": "ten", "maximum_budget": 5000})
    st = await start_stack(llm_settings, llm=fake)
    try:
        d = detail(st, await run_to_rest(st, SCENARIOS[1]))
        assert d["status"] == "failed" and d["error"]["class"] == "LLMOutputError"
    finally:
        await st.close()


async def test_ollama_client_maps_errors():
    def timeout_handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    client = OllamaClient("http://ollama.invalid", "m", 0.1)
    transport = httpx.MockTransport(timeout_handler)
    orig = httpx.AsyncClient

    class Patched(orig):
        def __init__(self, *a, **kw):
            kw["transport"] = transport
            super().__init__(*a, **kw)

    httpx.AsyncClient = Patched
    try:
        with pytest.raises(LLMTimeoutError):
            await client.chat_json("s", "u", {})
        transport.handler = lambda r: httpx.Response(200, json={"message": {"content": "not json"}})
        with pytest.raises(LLMOutputError):
            await client.chat_json("s", "u", {})
        transport.handler = lambda r: httpx.Response(200, json={"message": {"content": '{"a": 1}'}})
        assert await client.chat_json("s", "u", {}) == {"a": 1}
        assert await client.ping() is True
    finally:
        httpx.AsyncClient = orig

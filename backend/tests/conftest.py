import pytest

from app.config.settings import Settings
from app.main import start_stack

SAMPLE = "Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000."
SCENARIOS = {
    1: SAMPLE,
    2: "Buy 2 monitors for the Finance department with a maximum budget of ₹50,000.",
    3: "Purchase 20 laptops for the engineering department with a maximum budget of ₹20,00,000.",
    4: "Purchase 5 laptops for the marketing department with a maximum budget of ₹1,00,000.",
    5: "buy some stuff",
}


class FakeLLM:
    """Stands in for OllamaClient. Each attribute may be a value or an exception to raise."""

    def __init__(self, parse=None, text="LLM-written explanation.", available=True):
        self.parse, self.text, self.available = parse, text, available
        self.json_calls = 0
        self.text_calls = 0
        self.model = "fake-model"

    async def ping(self, timeout: float = 1.5) -> bool:
        return self.available

    async def chat_json(self, system, user, schema):
        self.json_calls += 1
        if isinstance(self.parse, Exception):
            raise self.parse
        return self.parse

    async def chat_text(self, system, user):
        self.text_calls += 1
        if isinstance(self.text, Exception):
            raise self.text
        return self.text


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        execution_mode="demo",
        database_url=f"sqlite:///{tmp_path}/app.db",
        checkpoint_db_path=str(tmp_path / "checkpoints.db"),
        rate_limit_executions_per_hour=1000,
        llm_retry_backoff_seconds=0.01,
        demo_reset_enabled=True,
    )


@pytest.fixture
async def stack(settings):
    st = await start_stack(settings, llm=FakeLLM())
    yield st
    await st.close()


async def run_to_rest(stack, text: str) -> str:
    ex, _ = stack.service.create(text, None)
    await stack.service.wait(ex.id)
    return ex.id

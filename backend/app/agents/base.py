"""Agent base class, execution context and the common agent executor (Sections 4 and 9)."""
import asyncio
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ValidationError

from app.config.settings import Settings
from app.database import repositories as repo
from app.database.database import Database
from app.database.models import utcnow
from app.errors import AgentFailedError, InternalError, ValidationFailure, WorkflowError
from app.events.publisher import EventPublisher
from app.services.llm_client import OllamaClient
from app.tools.registry import execute_tool, resolve_tool, to_jsonable

MAX_RETRIES = 2


@dataclass
class AgentContext:
    execution_id: str
    agent_id: str
    execution_mode: Literal["demo", "llm"]
    publisher: EventPublisher
    db: Database
    llm: OllamaClient | None
    settings: Settings

    async def call_tool(self, tool_name: str, **args: Any) -> Any:
        spec = resolve_tool(self.agent_id, tool_name)  # raises ToolPermissionError
        await self.publisher.publish(self.execution_id, "tool_invoked", self.agent_id, {"tool": tool_name, "arguments": args})
        started = time.perf_counter()
        with self.db.session() as s:
            result = execute_tool(spec, args, s)
        jsonable = to_jsonable(result)
        await self.publisher.publish(
            self.execution_id,
            "tool_completed",
            self.agent_id,
            {
                "tool": tool_name,
                "result": jsonable,
                "result_summary": _summarize(jsonable),
                "duration_ms": int((time.perf_counter() - started) * 1000),
            },
        )
        return result

    def require_llm(self) -> OllamaClient:
        if self.llm is None:
            raise InternalError("LLM mode requested but no LLM client is configured")
        return self.llm


def _summarize(result: Any) -> str:
    if isinstance(result, list):
        return f"{len(result)} item(s)"
    if isinstance(result, dict):
        return ", ".join(f"{k}={v}" for k, v in list(result.items())[:4])
    return str(result)[:120]


class BaseAgent(ABC):
    id: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str]
    responsibilities: ClassVar[list[str]]
    input_schema: ClassVar[type[BaseModel]]
    output_schema: ClassVar[type[BaseModel]]
    tools: ClassVar[list[str]]
    uses_llm_for: ClassVar[str] = "nothing"

    @abstractmethod
    async def run(self, agent_input: BaseModel, ctx: AgentContext) -> BaseModel: ...

    def metadata(self) -> dict[str, Any]:
        from app.tools.registry import TOOLS

        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "responsibilities": self.responsibilities,
            "tools": [{"name": t, "description": TOOLS[t].description} for t in self.tools],
            "llm_usage": self.uses_llm_for,
            "input_schema": self.input_schema.model_json_schema(),
            "output_schema": self.output_schema.model_json_schema(),
        }


def _error_record(exc: Exception, agent_id: str) -> dict[str, Any]:
    if not isinstance(exc, WorkflowError):
        exc = InternalError(f"{exc.__class__.__name__}: {exc}")
    return {
        "class": exc.error_class,
        "message": exc.message,
        "agent_id": agent_id,
        "retryable": exc.retryable,
        "details": exc.details,
    }


async def execute_agent(agent: BaseAgent, agent_input: dict[str, Any], ctx: AgentContext) -> dict[str, Any]:
    """Run an agent with timing, events, output validation, retries and error classification."""
    validated_input = agent.input_schema.model_validate(agent_input)
    input_json = validated_input.model_dump(mode="json")
    with ctx.db.session() as s:
        row_id = repo.start_agent_execution(s, ctx.execution_id, agent.id, input_json).id
    await ctx.publisher.publish(ctx.execution_id, "agent_started", agent.id, {"input": input_json})

    started = time.perf_counter()
    attempt = 0
    while True:
        attempt += 1
        try:
            raw = await agent.run(validated_input, ctx)
            try:
                output = agent.output_schema.model_validate(raw.model_dump() if isinstance(raw, BaseModel) else raw)
            except ValidationError as exc:
                raise ValidationFailure(
                    f"{agent.name} produced output that does not match {agent.output_schema.__name__}",
                    exc.errors(include_url=False),
                ) from exc
            break
        except Exception as exc:  # noqa: BLE001 - classified below
            retryable = isinstance(exc, WorkflowError) and exc.retryable
            if retryable and attempt <= MAX_RETRIES:
                with ctx.db.session() as s:
                    repo.update_agent_execution(s, row_id, attempt=attempt + 1)
                await asyncio.sleep(ctx.settings.llm_retry_backoff_seconds * attempt)
                continue
            record = _error_record(exc, agent.id)
            duration = int((time.perf_counter() - started) * 1000)
            with ctx.db.session() as s:
                repo.update_agent_execution(
                    s, row_id, status="failed", error_json=record, attempt=attempt, completed_at=utcnow(), duration_ms=duration
                )
            await ctx.publisher.publish(
                ctx.execution_id, "agent_failed", agent.id, {"error": record, "attempt": attempt, "duration_ms": duration}
            )
            raise AgentFailedError(record) from exc

    output_json = output.model_dump(mode="json")
    duration = int((time.perf_counter() - started) * 1000)
    with ctx.db.session() as s:
        repo.update_agent_execution(
            s, row_id, status="completed", output_json=output_json, attempt=attempt, completed_at=utcnow(), duration_ms=duration
        )
    await ctx.publisher.publish(
        ctx.execution_id, "agent_completed", agent.id, {"output": output_json, "duration_ms": duration, "attempt": attempt}
    )
    return output_json

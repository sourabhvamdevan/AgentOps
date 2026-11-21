"""Starts, resumes, fails and recovers workflow executions (Sections 5.3, 5.4, 9)."""
import asyncio
import logging
from typing import Any

from langgraph.types import Command
from sqlalchemy.exc import IntegrityError

from app.agents.base import _error_record
from app.agents.registry import AGENT_ORDER
from app.database import repositories as repo
from app.database.models import ApprovalRequest, WorkflowExecution, utcnow
from app.database.seed import seed
from app.errors import AgentFailedError, InternalError
from app.orchestration.checkpointer import wipe_checkpoints
from app.orchestration.graph import Runtime
from app.orchestration.state import initial_state
from app.schemas.domain import HumanDecision
from app.tools.report_tools import build_report

log = logging.getLogger(__name__)


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


class ExecutionService:
    def __init__(self, rt: Runtime, graph, checkpointer=None):
        self.rt = rt
        self.graph = graph
        self.checkpointer = checkpointer
        self._tasks: dict[str, asyncio.Task] = {}

    # ---- lifecycle -------------------------------------------------------

    def create(self, raw_request: str, idempotency_key: str | None) -> tuple[WorkflowExecution, bool]:
        """Create and start an execution. Returns (execution, created). Same idempotency key -> original."""
        db = self.rt.db
        if idempotency_key:
            with db.session() as s:
                existing = repo.get_execution_by_idempotency_key(s, idempotency_key)
            if existing:
                return existing, False
        try:
            with db.session() as s:
                ex = repo.create_execution(s, raw_request, self.rt.settings.execution_mode, idempotency_key)
        except IntegrityError:
            with db.session() as s:
                return repo.get_execution_by_idempotency_key(s, idempotency_key), False
        self._spawn(ex.id, self._drive(ex.id, initial_state(ex.id, raw_request, ex.execution_mode)))
        return ex, True

    async def decide(self, approval_id: str, decision: str, comment: str | None) -> ApprovalRequest:
        db = self.rt.db
        with db.session() as s:
            approval = repo.get_approval(s, approval_id)
            execution_id = approval.execution_id if approval else None
        if execution_id and execution_id in self._tasks:
            # Never run two graph invocations on one thread: let any in-flight run settle first.
            await asyncio.shield(self._tasks[execution_id])
        with db.session() as s:
            approval = repo.get_approval(s, approval_id)
            if approval is None:
                raise NotFound(f"Approval '{approval_id}' not found")
            if approval.status != "pending":
                raise Conflict(f"Approval '{approval_id}' was already decided ({approval.status})")
            ex = repo.get_execution(s, approval.execution_id)
            if ex.status != "waiting_for_approval":
                raise Conflict(f"Execution is '{ex.status}', not waiting for approval")
            decided = repo.decide_approval(s, approval_id, "approved" if decision == "approve" else "rejected", comment)
            if decided is None:
                raise Conflict(f"Approval '{approval_id}' was already decided")
            repo.update_execution(s, ex.id, status="running")
        human = HumanDecision(decision=decision, decided_at=decided.decided_at, comment=comment).model_dump(mode="json")
        await self.rt.publisher.publish(decided.execution_id, "approval_received", None, {"approval_id": approval_id, **human})
        self._spawn(decided.execution_id, self._drive(decided.execution_id, Command(resume=human)))
        return decided

    def _spawn(self, execution_id: str, coro) -> None:
        task = asyncio.create_task(coro, name=f"execution-{execution_id}")
        self._tasks[execution_id] = task
        task.add_done_callback(lambda _t: self._tasks.pop(execution_id, None))

    async def wait(self, execution_id: str) -> None:
        task = self._tasks.get(execution_id)
        if task:
            await asyncio.shield(task)

    async def _drive(self, execution_id: str, graph_input: Any) -> None:
        config = {"configurable": {"thread_id": execution_id}}
        try:
            with self.rt.db.session() as s:
                repo.update_execution(s, execution_id, status="running")
            # durability="sync": every step is checkpointed before the next starts, so a pause is
            # durable by the time ainvoke returns and survives a process restart.
            await self.graph.ainvoke(graph_input, config, durability="sync")
            snapshot = await self.graph.aget_state(config)
            if snapshot.next:
                with self.rt.db.session() as s:
                    repo.update_execution(s, execution_id, status="waiting_for_approval", current_stage="human_review")
                    approval = repo.get_approval_for_execution(s, execution_id)
                    payload = {"approval_id": approval.id, "summary": approval.summary_json}
                await self.rt.publisher.publish(execution_id, "approval_requested", None, payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            if not isinstance(exc, AgentFailedError):
                log.exception("execution %s crashed", execution_id)
            await self._fail(execution_id, exc, config)

    async def _fail(self, execution_id: str, exc: Exception, config: dict) -> None:
        record = exc.record if isinstance(exc, AgentFailedError) else _error_record(exc, None)
        try:
            state = dict((await self.graph.aget_state(config)).values or {})
        except Exception:  # noqa: BLE001
            state = {}
        now = utcnow()
        with self.rt.db.session() as s:
            ex = repo.get_execution(s, execution_id)
            state.setdefault("execution_id", execution_id)
            state.setdefault("execution_mode", ex.execution_mode)
            statuses = dict(state.get("agent_statuses") or {a: "pending" for a in AGENT_ORDER})
            if record.get("agent_id"):
                statuses[record["agent_id"]] = "failed"
            state["agent_statuses"] = {a: ("skipped" if v in ("pending", "running") else v) for a, v in statuses.items()}
            report = build_report(state, "error", ex.created_at, now, f"{record['class']}: {record['message']}")
            repo.upsert_report(s, execution_id, report.model_dump(mode="json"))
            repo.update_execution(
                s, execution_id, status="failed", outcome="error", error_json=record, completed_at=now
            )
        await self.rt.publisher.publish(execution_id, "workflow_failed", record.get("agent_id"), {"error": record})

    # ---- startup / reset ---------------------------------------------------

    async def recover_on_startup(self) -> list[str]:
        """Mark executions orphaned by a restart as failed. Waiting executions stay resumable."""
        with self.rt.db.session() as s:
            orphaned = [e.id for e in repo.list_executions_with_status(s, ["created", "running"])]
        for eid in orphaned:
            record = {"class": "InternalError", "message": "interrupted by restart", "agent_id": None, "retryable": False, "details": None}
            with self.rt.db.session() as s:
                repo.update_execution(s, eid, status="failed", outcome="error", error_json=record, completed_at=utcnow())
            await self.rt.publisher.publish(eid, "workflow_failed", None, {"error": record})
        return orphaned

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def reset(self) -> None:
        await self.shutdown()
        with self.rt.db.session() as s:
            repo.wipe_runtime_data(s)
            seed(s)
        if self.checkpointer is not None:
            await wipe_checkpoints(self.checkpointer)


__all__ = ["ExecutionService", "NotFound", "Conflict", "InternalError"]

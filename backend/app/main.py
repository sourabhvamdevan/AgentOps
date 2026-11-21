"""FastAPI application factory."""
import logging
from dataclasses import dataclass
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import install_error_handlers
from app.api.rate_limit import RateLimiter
from app.api.routes import agents, approvals, demo, executions, health, monitor, workflows
from app.config.settings import Settings
from app.database.database import Database
from app.database.seed import seed
from app.events.bus import EventBus
from app.events.publisher import EventPublisher
from app.orchestration.checkpointer import close_checkpointer, open_checkpointer
from app.orchestration.graph import Runtime, build_graph
from app.services.execution_service import ExecutionService
from app.services.llm_client import OllamaClient

API_PREFIX = "/api/v1"
log = logging.getLogger("app")


@dataclass
class Stack:
    """Everything a running backend needs; shared by the app lifespan and the tests."""

    settings: Settings
    db: Database
    runtime: Runtime
    graph: object
    service: ExecutionService
    checkpointer: object

    async def close(self) -> None:
        await self.service.shutdown()
        await close_checkpointer(self.checkpointer)
        self.db.dispose()


async def start_stack(settings: Settings, llm: OllamaClient | None = None) -> Stack:
    db = Database(settings.database_url)
    db.migrate()
    with db.session() as s:
        seed(s)  # idempotent: keeps the demo usable on hosts with ephemeral disks
    checkpointer = await open_checkpointer(settings.checkpoint_db_path)
    llm = llm or OllamaClient(settings.ollama_base_url, settings.ollama_model, settings.llm_timeout_seconds)
    rt = Runtime(settings=settings, db=db, publisher=EventPublisher(db, EventBus()), llm=llm)
    graph = build_graph(rt, checkpointer)
    service = ExecutionService(rt, graph, checkpointer)
    recovered = await service.recover_on_startup()
    if recovered:
        log.warning("Marked %d execution(s) interrupted by restart as failed", len(recovered))
    return Stack(settings, db, rt, graph, service, checkpointer)


def create_app(settings: Settings | None = None, llm: OllamaClient | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        stack = await start_stack(settings, llm)
        app.state.stack = stack
        app.state.runtime, app.state.graph, app.state.service = stack.runtime, stack.graph, stack.service
        app.state.rate_limiter = RateLimiter(settings.rate_limit_executions_per_hour)
        try:
            yield
        finally:
            await stack.close()

    app = FastAPI(title="AgentOps", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Idempotent-Replay", "Retry-After"],
    )
    install_error_handlers(app)
    for r in (health, workflows, agents, executions, approvals, demo, monitor):
        app.include_router(r.router, prefix=API_PREFIX)
    return app


app = create_app()

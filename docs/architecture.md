# Architecture

```
Browser (React + Vite)
   │  REST /api/v1  ·  WebSocket /api/v1/executions/{id}/stream
   ▼
FastAPI app (single process)
   ├─ ExecutionService ── starts/resumes graph runs as asyncio tasks
   ├─ LangGraph graph ─── init → request → vendor → budget → approval → [human_review] → finalize
   │     └─ AsyncSqliteSaver checkpointer (checkpoints.db)
   ├─ Agents ─────────── common executor: timing, events, output validation, retries, error classes
   │     └─ Tools ────── allowlisted pure functions, Pydantic-validated arguments
   ├─ EventPublisher ─── persist to SQLite, then publish to the in-process EventBus
   └─ SQLAlchemy + Alembic ─ app.db (vendors, budgets, executions, agent runs, events, approvals, reports)

Optional: Ollama (llm mode only) for request parsing and explanation prose.
```

## Request lifecycle

1. `POST /executions` validates the body (10–500 chars), checks the idempotency key and the per-IP rate limit, inserts a `created` execution and spawns `_drive()` as an asyncio task. It returns `202` immediately.
2. `_drive()` marks the execution `running` and calls `graph.ainvoke(state, thread_id=execution_id, durability="sync")`.
3. Each agent node runs `execute_agent()`, which records an `agent_executions` row, emits `agent_started`, runs the agent (tools emit `tool_invoked` / `tool_completed`), validates the output against the agent's `output_schema`, and emits `agent_completed` (or `agent_failed`).
4. Conditional nodes emit `branch_selected` with the chosen branch and the reason.
5. If policy requires review, `human_review` creates the approval row and calls `interrupt()`. `ainvoke` returns; the service sees a pending task, sets `waiting_for_approval` and emits `approval_requested`.
6. `POST /approvals/{id}/decision` atomically moves the approval from `pending` (409 otherwise), emits `approval_received`, and resumes with `Command(resume=decision)`.
7. `finalize` decides the outcome, writes the deterministic report, sets `completed`, and emits `workflow_completed`.
8. Any agent failure propagates to the service, which sets `failed` / `error`, stores the `ErrorRecord`, writes an error report and emits `workflow_failed`.

## Events and streaming

`EventPublisher.publish()` takes a per-execution asyncio lock, computes `max(sequence) + 1`, commits the row, and only then pushes it to subscribers. The WebSocket handler subscribes first, replays persisted events after `after_sequence`, then forwards live events, skipping any sequence it already sent. It sends `{type:"closed"}` after a terminal event. The UI loads `GET /executions/{id}` and `/events` and then opens the socket from the last sequence, so a refresh never loses or duplicates events.

## Restart behaviour

On startup, migrations run, reference data is re-seeded (idempotent), and any execution left in `created` or `running` is marked `failed` with "interrupted by restart". Executions in `waiting_for_approval` keep their checkpoint and can be approved after the restart. This is covered by `test_resume_after_restart` and was also checked with a real `kill -9` of the server process.

## Code map

| Path | Responsibility |
|---|---|
| `backend/app/main.py` | App factory, lifespan, `start_stack()` shared with tests |
| `backend/app/orchestration/` | Graph, state, pure routing functions, checkpointer |
| `backend/app/agents/` | `BaseAgent`, executor, the four agents |
| `backend/app/tools/` | Parser, vendor scoring, budget and policy tools, report builder, allowlist registry |
| `backend/app/services/` | Execution lifecycle, Ollama client |
| `backend/app/events/` | Event bus and persist-then-publish publisher |
| `backend/app/database/` | Models, engine/migrations, repositories, seed |
| `backend/app/api/` | Routes, error envelope, serializers, rate limiter |
| `frontend/src/hooks/` | `useExecution` (REST + stream), `useExecutionStream` (reconnecting WS) |
| `frontend/src/pages/` | Overview, Workflow Explorer, Execution Monitor, Architecture |

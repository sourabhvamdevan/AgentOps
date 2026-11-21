# Decisions

Choices made where the plan was ambiguous or the environment forced a call. One line each.

- Repo root is this folder (`backend/`, `frontend/`, `docs/` at top level) rather than a nested `enterprise-ai-orchestrator/` directory.
- `WorkflowState` is a `TypedDict` whose agent payloads are JSON dicts (validated Pydantic dumps), so it serializes cleanly into the SQLite checkpointer; agents re-validate on read.
- Database access is synchronous SQLAlchemy on SQLite, called from async code in short transactions; acceptable for a single-process demo and avoids a second driver.
- `ParsedRequest` fields are nullable and gain a `reason` string so an invalid request can still be represented and explained.
- Vendor scoring: when a min-max range is degenerate (one candidate or identical values) cost/delivery normalize to 0 and rating to 1, as specified for the single-candidate case; final tie-break after total price is vendor id.
- Budget Agent still calls `get_department_budget` when no vendor is eligible, so a `skipped` result reports the available budget.
- Approval Agent emits rule names `budget_rejected` / `no_eligible_vendor` for auto-rejections, alongside policy rules `amount_above_human_approval_threshold` / `low_remaining_budget`.
- `branch_selected` is emitted at the end of the deciding agent node using the same pure routing function the conditional edge uses (routing stays side-effect free).
- An agent failure propagates out of the graph; the execution service marks the execution `failed` / outcome `error`, writes an error report, and emits `workflow_failed`. The graph shape stays exactly as in the plan.
- A request that fails validation ends with status `completed` and outcome `failed_validation` (status `failed` is reserved for errors).
- `approval_requested` and the `waiting_for_approval` status are emitted by the execution service only after the graph run has returned with a pending interrupt, and runs use `durability="sync"`. Emitting them inside the node let a fast decision race the still-running graph (found by the WebSocket test).
- The decision endpoint waits for any in-flight run on that execution before resuming, so two graph invocations never share a thread.
- Python 3.10 does not propagate LangGraph's config context var into async nodes, so `human_review` sets it from the node's explicit `config` before calling `interrupt()`. On 3.11+ this is a no-op.
- LLM transport failures (connection refused, 5xx) are classified as `LLMTimeoutError` (retryable) to stay within the five error classes in the plan.
- `GET /health` also returns `llm_model`, `demo_reset_enabled` and `data_source` so the UI can render the mode badge and reset button without extra endpoints.
- Idempotent replays of `POST /executions` return `200` with header `Idempotent-Replay: true`; new executions return `202`. Replays do not count against the rate limit.
- The WebSocket accepts `?after_sequence=N` so clients can reconnect without duplicates.
- Demo reset also wipes LangGraph checkpoint tables and cancels in-flight executions.
- `react-router` is added for the four routes; it is the only library beyond the listed stack. shadcn/ui components are vendored as source in `components/ui/` (the shadcn approach) instead of running the interactive CLI.
- Workflow Explorer shows the graph's `End` node as well as the eight listed nodes, since it exists in the compiled graph.
- Docker Compose serves the built frontend with nginx on port 5173 so the default `CORS_ORIGINS` works unchanged.

## AgentOps additions

- **Synthetic fallback lives in the frontend.** The public demo was unusable whenever its backend was asleep or unreachable. The browser now carries a TypeScript port of the demo-mode rules (`frontend/src/synthetic/engine.ts`) and a store that emits the same events. It is a fallback for an unreachable *API*, not for LLM failures: llm-mode errors are still shown, never hidden.
- **Two implementations of the monitor aggregates** (`monitor_service.py`, `synthetic/monitor.ts`) share one response shape, each covered by its own tests.
- **Automated run time excludes human-reviewed runs**, so approval waits do not distort latency; approval wait is reported separately.

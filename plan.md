# AgentOps — Multi-Agent Workflow Operations

A multi-agent procurement automation demo. One LangGraph orchestrator coordinates four specialized agents over a shared typed state, with tool execution, a human approval gate, persisted execution events, and a live dashboard.

**Stack:** FastAPI · LangGraph · Pydantic · SQLAlchemy · SQLite · WebSockets · React · Vite · TypeScript · Tailwind · shadcn/ui · React Flow

---

## 0. Instructions for the implementing agent (read first)

1. **Build in the phase order in Section 14.** Do not start a phase until the previous phase's acceptance checks pass.
2. **Do not add scope.** Section 2 lists what is excluded. If something is ambiguous, pick the simplest option consistent with this document, and record the decision in `docs/decisions.md` (one line each). Do not stop to ask.
3. **Every number comes from deterministic Python.** LLMs may only (a) parse the request text and (b) write explanation prose. Never let an LLM compute cost, budget, thresholds, or routing.
4. **Never fake execution.** Events shown in the UI must be real persisted backend events. Demo mode must be labeled as demo mode everywhere it applies.
5. **After each phase:** run the tests, fix failures, then continue. Keep a short `docs/progress.md` checklist.
6. Use the latest stable versions of all libraries at build time. Pin them in `requirements.txt` / `package.json` after installing. Check LangGraph's current docs for `interrupt` / `Command(resume=...)` / checkpointer APIs before writing the graph, since these have changed between versions.

---

## 1. Product summary

User submits a natural-language purchase request, for example:

> Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.

The system:
1. Parses it into structured requirements (Request Agent).
2. Compares vendors from a seeded dataset (Vendor Agent).
3. Validates cost against the department budget (Budget Agent).
4. Applies approval policy (Approval Agent).
5. Pauses for human approve/reject when policy requires it.
6. Produces a final structured procurement report.

The dashboard shows the workflow graph, live execution timeline, per-agent inputs/outputs, and the final report. All business data is fictional and labeled as such.

---

## 2. Scope

### In scope
- One domain (procurement), one workflow, one orchestrator, four agents.
- Fixed graph with conditional routing and one approval interrupt.
- Controlled backend tools only.
- SQLite persistence, REST API, one WebSocket endpoint.
- Two execution modes: `demo` (deterministic) and `llm` (Ollama).
- Four frontend pages.

### Out of scope (do not build)
Auth, accounts, multi-tenancy, RBAC, real purchases/payments/email, external vendor APIs, RAG/vector DBs, model training, microservices, Kubernetes, extra workflows, dynamic agent creation, document upload, analytics infrastructure, Redis/Celery/queues.

---

## 3. Execution modes

Set by env var `EXECUTION_MODE` = `demo` | `llm`. Default `demo`.

| | `demo` | `llm` |
|---|---|---|
| Request parsing | Regex/rule parser (Section 6.1) | Ollama call with JSON schema output; on timeout/invalid output, fail the agent (do not silently fall back) |
| Vendor/Approval explanation text | Template strings | Ollama-generated prose |
| Cost, budget, routing, approval rules | Deterministic Python | Deterministic Python (identical) |
| Graph, events, persistence, UI | Identical | Identical |

Requirements:
- Every execution record stores its `execution_mode`.
- UI shows a visible badge: **"Demo mode (deterministic rules)"** or **"LLM mode (model: <name>)"**.
- Public deployment runs `demo`. Do not claim LLM usage in demo mode.
- `llm` mode config: `OLLAMA_BASE_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `llama3.1:8b`), `LLM_TIMEOUT_SECONDS` (default 30).
- `GET /api/v1/health` returns `{status, execution_mode, llm_available}`. `llm_available` is true only if Ollama responds.

---

## 4. Agents

All agents extend a base class in `agents/base.py`:

```python
class BaseAgent(ABC):
    id: str            # "request_agent"
    name: str
    description: str
    responsibilities: list[str]
    input_schema: type[BaseModel]
    output_schema: type[BaseModel]
    tools: list[str]
    async def run(self, state: WorkflowState, ctx: AgentContext) -> BaseModel: ...
```

`AgentContext` provides: event publisher, execution mode, LLM client (nullable), DB session. Agents emit `agent_started`, `tool_invoked`, `tool_completed`, `agent_completed` through it. Wrap `run` in a common executor that handles timing, event emission, validation of output against `output_schema`, retries, and error classification (Section 9).

### 4.1 Request Agent
- **Input:** raw request text.
- **Output `ParsedRequest`:** `department: str`, `product: str`, `quantity: int`, `maximum_budget: int` (INR), `status: "valid"|"invalid"`, `missing_fields: list[str]`.
- **Tools:** none.
- Validation: `quantity` 1–1000, `maximum_budget` > 0, department must exist in `budgets`, product must exist in `vendors` catalog. Otherwise `status="invalid"` with `missing_fields` / reason.

### 4.2 Vendor Agent
- **Input:** `ParsedRequest`.
- **Tools:** `get_vendors(product) -> list[Vendor]`.
- **Output `VendorEvaluation`:** `candidates: list[VendorQuote]` (vendor_id, name, unit_price, total_price, delivery_days, rating, score, within_budget), `recommended_vendor_id: str|None`, `explanation: str`.
- Selection logic (deterministic, in `tools/vendor_tools.py`):
  - `total_price = unit_price * quantity`
  - Only vendors with `total_price <= maximum_budget` are eligible. If none eligible, `recommended_vendor_id = None`.
  - Score among eligible (min-max normalized across eligible set; if one candidate, all normalized terms = 0 for cost/delivery and 1 for rating): `score = 0.6*(1 - price_norm) + 0.25*(1 - delivery_norm) + 0.15*rating_norm`. Highest score wins; ties broken by lower total price.
- The LLM (in `llm` mode) only writes `explanation`.

### 4.3 Budget Agent
- **Input:** `ParsedRequest`, `VendorEvaluation`.
- **Tools:** `get_department_budget(department)`, `calculate_budget_check(requested, available)`.
- **Output `BudgetValidation`:** `requested_amount`, `available_budget`, `remaining_budget`, `status: "approved"|"rejected"|"skipped"`, `reason: str`.
- Rules: if no recommended vendor → `status="skipped"`. Else `requested_amount = recommended vendor total_price`. `approved` iff `requested_amount <= available_budget` AND `requested_amount <= maximum_budget`. `remaining_budget = available_budget - requested_amount`. Pure Python; no LLM.

### 4.4 Approval Agent
- **Input:** `ParsedRequest`, `VendorEvaluation`, `BudgetValidation`.
- **Tools:** `evaluate_policy(requested_amount, available_budget, remaining_budget) -> PolicyResult`.
- **Output `ApprovalAssessment`:** `approval_required: bool`, `recommendation: "approve"|"reject"`, `triggered_rules: list[str]`, `summary: str`.
- Policy rules (constants in `config/policy.py`):
  - `HUMAN_APPROVAL_THRESHOLD_INR = 500_000`: amount above this requires human approval.
  - `LOW_REMAINING_BUDGET_RATIO = 0.10`: remaining budget below 10% of available requires human approval.
  - Budget `rejected` or `skipped` → `recommendation="reject"`, `approval_required=False` (auto-rejected, no human step).
- The agent recommends. The human decision is final.

---

## 5. Orchestration (LangGraph)

### 5.1 Graph

```
START → init → request_agent ──(invalid)──────────────→ finalize
                  │(valid)
                  ▼
            vendor_agent → budget_agent → approval_agent
                                              │
                    ┌──────(approval_required=False)──────┐
                    │                                     │
                    ▼                                     │
              human_review (interrupt) ───────────────────┤
                                                          ▼
                                                      finalize → END
```

Routing (in `orchestration/routing.py`, pure functions, unit-tested):
- After `request_agent`: `status=="invalid"` → `finalize` with outcome `failed_validation`; else `vendor_agent`.
- After `approval_agent`: `approval_required` → `human_review`; else `finalize`.
- After `human_review`: always `finalize`.
- Emit a `branch_selected` event for each conditional decision, including the chosen branch and why.

### 5.2 State (`orchestration/state.py`)

```python
class WorkflowState(TypedDict):  # or Pydantic model, pick one and be consistent
    execution_id: str
    raw_request: str
    execution_mode: Literal["demo", "llm"]
    parsed_request: ParsedRequest | None
    vendor_evaluation: VendorEvaluation | None
    budget_validation: BudgetValidation | None
    approval_assessment: ApprovalAssessment | None
    human_decision: HumanDecision | None   # {decision, decided_at, comment}
    current_stage: str
    agent_statuses: dict[str, Literal["pending","running","completed","failed","skipped"]]
    outcome: Literal["approved","rejected","failed_validation","error"] | None
    errors: list[ErrorRecord]
    final_report: ProcurementReport | None
```

### 5.3 Human approval
- Use LangGraph's `interrupt()` inside `human_review` and resume with `Command(resume=...)`.
- Use a SQLite-backed checkpointer (`langgraph-checkpoint-sqlite`) so resume survives a process restart. **Test this** (Section 13); only then claim it in docs/UI.
- On interrupt: set execution status `waiting_for_approval`, create an `approval_requests` row (`pending`), emit `approval_requested`.
- Decision endpoint validates the approval exists and is `pending` (reject double decisions with 409), saves it, emits `approval_received`, resumes the graph.
- Final `outcome`: human approve → `approved`; human reject → `rejected`; auto path → `approved` if recommendation is approve, else `rejected`.

### 5.4 Execution model
- `POST /executions` creates the record, starts the graph as a background `asyncio` task in the same process, returns immediately.
- Nodes are `async`. Run strictly sequentially. No worker infrastructure.
- Events go through an in-process pub/sub keyed by `execution_id`; every event is persisted *before* being published.

---

## 6. Tools and data

Tools are plain Python functions in `tools/`, registered in an allowlist per agent. A call to a tool not on the agent's allowlist raises `ToolPermissionError`. Validate tool arguments with Pydantic. Tools emit `tool_invoked` / `tool_completed` events with arguments and result summary.

### 6.1 Demo-mode request parser
Deterministic parser in `tools/request_parser.py`:
- Quantity: first integer adjacent to a product noun (`10 laptops`).
- Product: match against catalog names/plurals (case-insensitive): laptop, monitor, keyboard.
- Department: match `for the <name> department` or any known department name (case-insensitive).
- Budget: patterns like `₹8,00,000`, `Rs 800000`, `INR 8 lakh`, `8L`, `8 lakh`, `₹8,00,000`. Handle Indian digit grouping and `lakh`/`crore`.
- Missing pieces → `status="invalid"` and list `missing_fields`.

### 6.2 Seed data (fictional; include a `data_source: "synthetic"` note in the UI)

`vendors` (unit price in INR):

| id | name | product | unit_price | delivery_days | rating |
|---|---|---|---|---|---|
| v1 | NorthPeak Systems | laptop | 74000 | 7 | 4.2 |
| v2 | Zenvolt Technologies | laptop | 68500 | 12 | 3.9 |
| v3 | Corebridge Supplies | laptop | 82000 | 4 | 4.7 |
| v4 | Lumina Hardware | laptop | 91000 | 3 | 4.5 |
| v5 | Pixelgrid Distribution | monitor | 14500 | 5 | 4.1 |
| v6 | Zenvolt Technologies | monitor | 13200 | 9 | 3.8 |
| v7 | Corebridge Supplies | keyboard | 2400 | 3 | 4.4 |
| v8 | NorthPeak Systems | keyboard | 2100 | 6 | 4.0 |

`budgets` (available, INR): Engineering 1,200,000 · Marketing 400,000 · Finance 600,000 · HR 250,000.

Seed these with an idempotent script (`python -m app.database.seed`). Demo reset (Section 10) re-runs it.

### 6.3 Required test scenarios (must produce these outcomes in demo mode)

| # | Request | Expected |
|---|---|---|
| 1 | 10 laptops, Engineering, max ₹8,00,000 | Vendor v2 or v1 per scoring; amount ≤ 8L; > 5L threshold → **waiting for approval** |
| 2 | 2 monitors, Finance, max ₹50,000 | Within thresholds → **auto-approved**, no human step |
| 3 | 20 laptops, Engineering, max ₹20,00,000 | Cost exceeds available budget (₹12L) → budget rejected → **auto-rejected** |
| 4 | 5 laptops, Marketing, max ₹1,00,000 | No vendor within max budget → budget skipped → **auto-rejected** |
| 5 | "buy some stuff" | Request agent invalid → **failed_validation** |
| 6 | 10 laptops, Engineering, max ₹8,00,000, human rejects | Outcome **rejected** |

Compute exact expected numbers when writing the tests, then assert them.

---

## 7. Database

SQLAlchemy 2.x models, SQLite. Use string UUIDs, `created_at`/`updated_at` timestamps (UTC), JSON columns for structured payloads. Use Alembic for migrations.

| Table | Key columns |
|---|---|
| `vendors` | id, name, product, unit_price, delivery_days, rating |
| `budgets` | id, department, available_budget |
| `workflow_executions` | id, raw_request, execution_mode, status, current_stage, outcome, idempotency_key (unique, nullable), created_at, updated_at, completed_at |
| `agent_executions` | id, execution_id (FK), agent_id, status, input_json, output_json, error_json, attempt, started_at, completed_at, duration_ms |
| `execution_events` | id, execution_id (FK), sequence (int, monotonic per execution), agent_id (nullable), event_type, data_json, timestamp |
| `approval_requests` | id, execution_id (FK), status (`pending`/`approved`/`rejected`), summary_json, decision_comment, requested_at, decided_at |
| `generated_reports` | id, execution_id (FK, unique), report_json, created_at |

Execution statuses: `created`, `running`, `waiting_for_approval`, `completed`, `failed`, `cancelled`. The backend is the only source of truth for status.

Repository functions live in `database/repositories.py`. API routes never touch the session directly beyond dependency injection.

---

## 8. API

Base path `/api/v1`. All responses JSON. Errors use `{ "error": { "code": str, "message": str, "details": any } }`.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | mode and LLM availability |
| GET | `/workflows` | list (one item: `procurement`) |
| GET | `/workflows/{workflow_id}` | nodes and edges, generated from the real graph definition |
| GET | `/agents` | list of agent metadata |
| GET | `/agents/{agent_id}` | description, responsibilities, input/output schema (JSON Schema), tools |
| POST | `/executions` | body `{ "request": str }`, optional header `Idempotency-Key`. Returns `202` + execution summary |
| GET | `/executions` | newest first, paginated (`limit`, `offset`) |
| GET | `/executions/{id}` | full state: status, stage, parsed/vendor/budget/approval results, agent executions, report |
| GET | `/executions/{id}/events` | ordered by `sequence`; supports `?after_sequence=N` |
| GET | `/approvals` | list; filter `?status=pending` |
| POST | `/approvals/{approval_id}/decision` | body `{ "decision": "approve"\|"reject", "comment": str? }` |
| POST | `/demo/reset` | wipes executions/events/approvals/reports, re-seeds; only enabled when `DEMO_RESET_ENABLED=true` |
| WS | `/executions/{id}/stream` | on connect: replay persisted events, then stream new ones; send `{type:"event", event:{...}}` and a final `{type:"closed"}` when execution reaches a terminal status |

Request validation: `request` 10–500 chars, stripped. Rate limit `POST /executions`: 10 per hour per client IP (in-memory limiter is acceptable). Idempotency: same key returns the original execution.

Sample `POST /executions` response:

```json
{
  "id": "6f1d...",
  "status": "created",
  "execution_mode": "demo",
  "raw_request": "Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.",
  "created_at": "2026-01-01T10:30:01Z"
}
```

Event shape:

```json
{
  "id": "…", "execution_id": "…", "sequence": 4,
  "agent_id": "request_agent",
  "event_type": "agent_completed",
  "timestamp": "2026-01-01T10:30:04Z",
  "data": { "output": { } , "duration_ms": 1830 }
}
```

Event types (enum): `workflow_initialized`, `agent_started`, `tool_invoked`, `tool_completed`, `agent_completed`, `agent_failed`, `branch_selected`, `approval_requested`, `approval_received`, `workflow_completed`, `workflow_failed`.

CORS: allow origins from `CORS_ORIGINS` env var.

---

## 9. Reliability

- Pydantic validation on all API inputs, tool arguments, agent outputs.
- Model call timeout (`LLM_TIMEOUT_SECONDS`); max 2 retries with short backoff for transient errors (timeouts, connection errors) only. Do not retry validation errors.
- Error classes: `ValidationError`, `ToolPermissionError`, `LLMTimeoutError`, `LLMOutputError`, `InternalError`. Persist as `ErrorRecord {class, message, agent_id, retryable}`.
- Agent failure → emit `agent_failed`, set execution `failed`, `outcome="error"`, show a clear message. Never mark success on failure.
- On startup, any execution left in `running` is marked `failed` with message "interrupted by restart". Executions in `waiting_for_approval` remain resumable via the checkpointer.
- Duplicate protection via idempotency key.

---

## 10. Final report

Generated by `tools/report_tools.py` (deterministic). `ProcurementReport`:

```json
{
  "execution_id": "…",
  "outcome": "approved",
  "execution_mode": "demo",
  "request_summary": { "department": "Engineering", "product": "Laptop", "quantity": 10, "maximum_budget": 800000 },
  "recommended_vendor": { "name": "…", "unit_price": 0, "total_price": 0, "delivery_days": 0 },
  "vendor_comparison": [ ],
  "budget": { "requested_amount": 0, "available_budget": 0, "remaining_budget": 0, "status": "approved" },
  "approval": { "required": true, "decision": "approved", "decided_by": "demo_user", "comment": null },
  "timeline_summary": { "started_at": "…", "completed_at": "…", "agents_run": 4 },
  "disclaimer": "All data is fictional. No real purchase was made."
}
```

Failure outcomes (`failed_validation`, rejection) still produce a report with the relevant sections null and a `reason` field.

---

## 11. Frontend

### 11.1 Design tokens
Light theme. Font: Inter. Background `#FFFFFF` / surface `#F6F7F9`. Text `#1F2328`. Muted text `#656D76`. Border `#D8DEE4`. Single accent blue `#2563EB`. Status colors: green `#16A34A`, amber `#D97706`, red `#DC2626`. Radius 8px. No gradients, no neon, minimal shadows, subtle transitions only. Sidebar (fixed, ~240px) + main workspace. Responsive: sidebar collapses to a top bar/drawer below 768px.

### 11.2 Routes

| Route | Page |
|---|---|
| `/` | Overview |
| `/workflow` | Workflow Explorer |
| `/monitor` and `/monitor/:executionId` | Execution Monitor |
| `/architecture` | Architecture |

### 11.3 Pages

**Overview:** project description, workflow card, agent count (from API), most recent execution + status, mode badge, buttons **Explore Demo** (→ `/monitor`) and **View Architecture**.

**Workflow Explorer:** React Flow graph built from `GET /workflows/procurement`. Nodes: Start, Orchestrator, Request, Vendor, Budget, Approval, Human Review, Final Report. Click a node → side panel with description, responsibilities, input/output schema, tools (from `GET /agents/{id}`). Read-only graph (no dragging/editing).

**Execution Monitor** (most important):
- Request input box prefilled with the sample request, a **Run** button, and a few one-click sample requests mapped to the scenarios in 6.3.
- Mode badge and execution status badge.
- Agent pipeline strip: pending / active / completed / failed / skipped per agent.
- Timeline: real events from REST (initial load) + WebSocket (live). Show timestamp, event type, agent, short summary. Click an event or agent → inspect JSON input/output.
- Approval panel when status is `waiting_for_approval`: purchase details, requested amount, available budget, vendor recommendation, triggered rules, **Approve** / **Reject** buttons with optional comment.
- Final report view (formatted, plus raw JSON toggle).
- Error banner for failures with the error class and message.
- Recent executions list; **Reset demo** button if the backend reports reset enabled.
- On page refresh, reload state via `GET /executions/{id}` and `GET /executions/{id}/events`, then re-subscribe to the WebSocket.

**Architecture:** static page with a diagram (React Flow or SVG): Frontend → REST/WS API → Orchestrator → Agents → Tools → SQLite, plus LLM provider box (Ollama, optional). Short sections: execution lifecycle, execution modes, technology choices, limitations (ephemeral SQLite on free hosting, single process, no auth).

### 11.4 Frontend structure

```
frontend/src/
  components/   (ui/ for shadcn, plus StatusBadge, EventTimeline, AgentPipeline, ApprovalPanel, ReportView, JsonViewer, ModeBadge)
  pages/        (Overview, WorkflowExplorer, ExecutionMonitor, Architecture)
  services/     (api.ts, ws.ts)
  hooks/        (useExecution, useExecutionStream)
  types/        (mirror backend schemas)
  App.tsx
```

Use plain `fetch` and small hooks; do not add state-management or data-fetching libraries beyond the listed stack. Handle loading, empty, and error states on every page.

---

## 12. Security

- Secrets only via env vars; provide `.env.example`; never commit `.env`.
- No arbitrary code execution; tools are an allowlist of pure functions.
- Input length limits and rate limiting (Section 8).
- Approval endpoint only acts on existing pending approvals.
- Public demo uses only fictional data; no real transactions.
- Treat the request text as untrusted: never interpolate it into SQL or shell; in `llm` mode place it in a clearly delimited user-content block and validate output against the schema.

---

## 13. Testing

Backend (`pytest`, `pytest-asyncio`, `httpx`):
- **Unit:** request parser (including Indian-format amounts, missing fields), vendor scoring, budget calculation, policy rules, tool allowlist enforcement, routing functions, Pydantic output validation.
- **Integration:** run the graph end-to-end in demo mode for all six scenarios in 6.3; DB persistence of agents/events/reports; event sequence monotonic and persisted before publish; approval interrupt and resume; **resume after simulated restart** (new graph instance, same checkpointer DB); double-decision returns 409; idempotency key; rate limit; LLM timeout path (mock the client) ends in `failed` with a clear error; WebSocket replay + live stream.
- **API:** every endpoint, including error shapes.

Frontend: component tests (Vitest + Testing Library) for `EventTimeline`, `ApprovalPanel`, and mode badge; one Playwright test for the full journey (submit sample request → see events → approve → see final report). Playwright is optional if time-constrained; backend tests are not.

---

## 14. Build phases and acceptance checks

**Phase 1: Backend foundation**
Build: project skeleton, config, DB models + Alembic, seed script, Pydantic schemas, `BaseAgent`, tools, request parser, health endpoint.
Accept: `pytest` passes for parser/tools/scoring/policy; `python -m app.database.seed` is idempotent; `GET /health` works.

**Phase 2: Orchestration**
Build: four agents, graph, routing, state, checkpointer, event layer, persistence, `POST /executions`, events REST, WebSocket, approvals endpoints.
Accept: all six scenarios in 6.3 pass via API in demo mode; approval pause/resume works; events persisted and replayable.

**Phase 3: Frontend**
Build: design system, layout, four pages, API/WS integration.
Accept: full journey works manually against the local backend; refresh mid-execution restores the timeline.

**Phase 4: Hardening**
Build: error handling and retries, restart behavior, rate limit, idempotency, demo reset, `llm` mode (Ollama), mode badges, remaining tests.
Accept: all tests green; killing the backend while waiting for approval and restarting still allows approval to complete the workflow.

**Phase 5: Deployment and docs**
Build: Dockerfile, `docker-compose.yml` (backend + frontend), frontend env config for API base URL, README run instructions, `docs/` files, deployment notes for Vercel (frontend) and Render (backend).
Accept: `docker compose up` runs the full app; documented steps deploy the demo in `demo` mode with no API keys.

**Phase 6 (optional): Extraction eval harness**
Build: `evals/` with ~30 labeled purchase requests (JSON), a script comparing the rule parser vs. the Ollama parser on field-level accuracy, latency, and failure rate; output a markdown results table in `docs/evals.md`. Report only measured numbers; label the model and hardware used.

---

## 15. Repository layout

```
enterprise-ai-orchestrator/
├── frontend/
├── backend/
│   ├── app/
│   │   ├── api/routes/ (workflows.py, executions.py, approvals.py, agents.py, demo.py, health.py)
│   │   ├── agents/ (base.py, request_agent.py, vendor_agent.py, budget_agent.py, approval_agent.py)
│   │   ├── orchestration/ (graph.py, state.py, routing.py, checkpointer.py)
│   │   ├── tools/ (request_parser.py, vendor_tools.py, budget_tools.py, policy_tools.py, report_tools.py, registry.py)
│   │   ├── database/ (models.py, database.py, repositories.py, seed.py)
│   │   ├── schemas/
│   │   ├── services/ (execution_service.py, llm_client.py)
│   │   ├── events/ (bus.py, publisher.py)
│   │   ├── config/ (settings.py, policy.py)
│   │   └── main.py
│   ├── alembic/
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── docs/ (architecture.md, agent-design.md, workflow-design.md, database-schema.md, demo-guide.md, decisions.md, progress.md)
├── .env.example
├── .gitignore
├── docker-compose.yml
└── README.md
```

Do not create empty modules. Only add a file if it has a real responsibility.

---

## 16. Environment variables (`.env.example`)

```
EXECUTION_MODE=demo
DATABASE_URL=sqlite:///./data/app.db
CHECKPOINT_DB_PATH=./data/checkpoints.db
CORS_ORIGINS=http://localhost:5173
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
LLM_TIMEOUT_SECONDS=30
DEMO_RESET_ENABLED=true
RATE_LIMIT_EXECUTIONS_PER_HOUR=10
```

Frontend: `VITE_API_BASE_URL=http://localhost:8000/api/v1`.

---

## 17. Deployment notes (document honestly in `docs/demo-guide.md`)

- Free hosts may sleep, time out, or wipe local disk. SQLite and checkpoint files on ephemeral storage are not permanent; the demo reset and startup re-seed must make the app usable after any restart.
- The deployed backend cannot reach a laptop's Ollama. Public deployment runs `demo` mode.
- Do not promise production availability or enterprise-grade concurrency.

---

## 18. Definition of done

- [ ] All six scenarios in 6.3 pass in an automated test.
- [ ] Approval pause, decision, resume work, including after a simulated restart.
- [ ] Monitor shows only real persisted events and survives page refresh.
- [ ] Mode badge is correct in both modes; demo mode never claims LLM use.
- [ ] Failures surface clear errors; no silent success.
- [ ] Workflow graph in the UI is generated from the backend definition.
- [ ] `pytest` green; `docker compose up` works from a clean checkout.
- [ ] No secrets in the repo; `.env.example` present.
- [ ] README has run instructions, architecture summary, and honest limitations.
# Progress

- [x] Phase 1: backend foundation (config, models + Alembic, idempotent seed, schemas, BaseAgent, tools, parser, health)
- [x] Phase 2: orchestration (4 agents, LangGraph graph, routing, SQLite checkpointer, events, REST, WebSocket, approvals); all six scenarios pass
- [x] Phase 3: frontend (design tokens, layout, Overview, Workflow Explorer, Execution Monitor, Architecture); full journey and refresh-mid-execution verified in a real browser
- [x] Phase 4: hardening (retries, restart recovery, rate limit, idempotency, demo reset, llm mode, mode badges); `kill -9` while waiting for approval, restart, approve: completes
- [x] Phase 5: Dockerfiles, docker-compose, README, docs, Vercel/Render notes. `docker compose config` validates; the images were **not** built here because the build sandbox cannot reach Docker Hub
- [x] Phase 6 (optional): eval harness; rule parser measured, Ollama parser not measured (no Ollama in the build sandbox)

## Test status at hand-off

- Backend: 70 pytest tests passing (unit, integration incl. resume-after-restart, API incl. WebSocket, llm-mode with mocked client)
- Frontend: 9 Vitest component tests passing (`EventTimeline`, `ApprovalPanel`, `ModeBadge`); `tsc` and `vite build` clean
- E2E: 2 Playwright tests passing against a live backend + Vite dev server (Chrome)

## Definition of done

- [x] All six scenarios in 6.3 pass in an automated test
- [x] Approval pause, decision, resume work, including after a simulated restart
- [x] Monitor shows only real persisted events and survives page refresh
- [x] Mode badge is correct in both modes; demo mode never claims LLM use
- [x] Failures surface clear errors; no silent success
- [x] Workflow graph in the UI is generated from the backend definition
- [~] `pytest` green; `docker compose up` from a clean checkout: pytest is green; compose is valid but not run (see above)
- [x] No secrets in the repo; `.env.example` present
- [x] README has run instructions, architecture summary, and honest limitations

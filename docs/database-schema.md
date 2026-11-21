# Database schema

SQLite via SQLAlchemy 2.x; migrations in `backend/alembic/versions/`. All tables have string UUID (or fixed seed) ids and UTC `created_at` / `updated_at`. Timestamps are stored in UTC and always returned timezone-aware.

| Table | Columns | Notes |
|---|---|---|
| `vendors` | id, name, product, unit_price, delivery_days, rating | Seeded, synthetic |
| `budgets` | id, department (unique), available_budget | Seeded, synthetic |
| `workflow_executions` | id, raw_request, execution_mode, status, current_stage, outcome, error_json, idempotency_key (unique, nullable), completed_at | Status: created, running, waiting_for_approval, completed, failed, cancelled |
| `agent_executions` | id, execution_id → executions, agent_id, status, input_json, output_json, error_json, attempt, started_at, completed_at, duration_ms | One row per agent run; `attempt` counts retries |
| `execution_events` | id, execution_id → executions, sequence, agent_id, event_type, data_json, timestamp | Unique (execution_id, sequence); sequence is monotonic per execution |
| `approval_requests` | id, execution_id → executions, status, summary_json, decision_comment, requested_at, decided_at | Decisions use a conditional `UPDATE … WHERE status='pending'` so double decisions are rejected |
| `generated_reports` | id, execution_id → executions (unique), report_json | Deterministic `ProcurementReport` |

`workflow_executions.error_json` is an addition to the plan's column list; it stores the `ErrorRecord` shown in the UI's error banner.

LangGraph checkpoints live in a separate SQLite file (`CHECKPOINT_DB_PATH`) managed by `langgraph-checkpoint-sqlite`.

Seed: `cd backend && python -m app.database.seed` (also runs on every startup; idempotent).

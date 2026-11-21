# Agent design

All agents extend `BaseAgent` (`backend/app/agents/base.py`) and declare `id`, `name`, `description`, `responsibilities`, `input_schema`, `output_schema` and `tools`. They are run through `execute_agent()`, never called directly.

## Executor contract

- Validates the input against `input_schema`.
- Persists an `agent_executions` row and emits `agent_started` with the input.
- Calls `run()`. Tools are called through `ctx.call_tool(name, **args)`, which checks the agent's allowlist (`ToolPermissionError` otherwise), validates arguments with the tool's Pydantic model, and emits `tool_invoked` / `tool_completed`.
- Validates the return value against `output_schema` (`ValidationError` on mismatch).
- Retries only retryable errors (`LLMTimeoutError`) up to 2 times with linear backoff. Validation and output errors are not retried.
- On final failure: row `failed` with an `ErrorRecord {class, message, agent_id, retryable}`, `agent_failed` event, `AgentFailedError` raised.

## Agents

| Agent | Tools | LLM use (llm mode only) | Output |
|---|---|---|---|
| Request | none | Field extraction with a JSON schema; output still goes through the same deterministic validation | `ParsedRequest` |
| Vendor | `get_vendors` | Explanation prose | `VendorEvaluation` |
| Budget | `get_department_budget`, `calculate_budget_check` | none | `BudgetValidation` |
| Approval | `evaluate_policy` | Summary prose | `ApprovalAssessment` |

### Request Agent
Demo mode uses `tools/request_parser.py`: quantity adjacent to a catalog noun (up to two words between), product from the catalog incl. plurals, department from "for the X department" or any known department name, and INR amounts in `₹8,00,000`, `Rs 800000`, `INR 8 lakh`, `8L`, `1.2 crore`, `20k` forms. Validation: quantity 1–1000, budget > 0, department in `budgets`, product in `vendors`. In llm mode the request text is placed inside `<user_request>` tags and the model is told not to follow instructions in it.

### Vendor Agent
`total = unit_price × quantity`; only vendors with `total ≤ maximum_budget` are eligible. Eligible vendors are min-max normalized and scored `0.6·(1−price) + 0.25·(1−delivery) + 0.15·rating`; ties go to the lower total.

### Budget Agent
No recommended vendor → `skipped`. Otherwise `approved` iff the amount is within both the department's available budget and the request's maximum; `remaining = available − requested`.

### Approval Agent
Budget `rejected`/`skipped` → `reject`, no human step. Otherwise `evaluate_policy` triggers human review when the amount exceeds ₹5,00,000 or less than 10% of the budget would remain. The agent recommends; the human decision is final.

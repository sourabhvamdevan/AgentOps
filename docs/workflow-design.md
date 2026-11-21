# Workflow design

```
START → init → request_agent ──(invalid)──────────────→ finalize
                  │(valid)
                  ▼
            vendor_agent → budget_agent → approval_agent
                                              │
                    ┌──────(approval required)┤
                    ▼                         │(not required)
              human_review (interrupt) ───────┤
                                              ▼
                                          finalize → END
```

The UI's Workflow Explorer draws this from `GET /workflows/procurement`, which reads nodes and edges from the compiled graph (`compiled.get_graph()`), so the picture cannot drift from the code.

## Routing (`orchestration/routing.py`)

| After | Condition | Next |
|---|---|---|
| `request_agent` | `parsed_request.status == "valid"` | `vendor_agent` |
| `request_agent` | otherwise | `finalize` (outcome `failed_validation`) |
| `approval_agent` | `approval_required` | `human_review` |
| `approval_agent` | otherwise | `finalize` |
| `human_review` | always | `finalize` |

## Outcomes

| Path | Outcome |
|---|---|
| Invalid request | `failed_validation` |
| Human approves / rejects | `approved` / `rejected` |
| No human step, recommendation approve / reject | `approved` / `rejected` |
| Any agent error | `error` (status `failed`) |

## Scenarios (demo mode, all in `tests/test_workflow.py`)

| # | Request | Result |
|---|---|---|
| 1 | 10 laptops, Engineering, ₹8,00,000 | v2 Zenvolt (score 0.60 vs v1 0.40), ₹6,85,000, remaining ₹5,15,000 → waiting for approval (amount above ₹5L) |
| 2 | 2 monitors, Finance, ₹50,000 | v6 Zenvolt, ₹26,400, remaining ₹5,73,600 → auto-approved |
| 3 | 20 laptops, Engineering, ₹20,00,000 | v1 NorthPeak (0.65), ₹14,80,000 > ₹12,00,000 available → budget rejected → auto-rejected |
| 4 | 5 laptops, Marketing, ₹1,00,000 | no vendor ≤ ₹1L → budget skipped → auto-rejected |
| 5 | "buy some stuff" | invalid → failed_validation |
| 6 | Scenario 1, human rejects | rejected |

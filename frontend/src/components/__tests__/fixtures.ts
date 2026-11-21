import type { Approval, ExecutionEvent } from "../../types";

export const ev = (sequence: number, event_type: ExecutionEvent["event_type"], agent_id: string | null, data: Record<string, unknown> = {}): ExecutionEvent => ({
  id: `e${sequence}`,
  execution_id: "x1",
  sequence,
  agent_id,
  event_type,
  timestamp: "2026-01-01T10:30:0" + (sequence % 10) + "Z",
  data,
});

export const approval: Approval = {
  id: "a1",
  execution_id: "x1",
  status: "pending",
  decision_comment: null,
  requested_at: "2026-01-01T10:30:05Z",
  decided_at: null,
  summary: {
    department: "Engineering",
    product: "laptop",
    quantity: 10,
    maximum_budget: 800000,
    vendor: { vendor_id: "v2", name: "Zenvolt Technologies", unit_price: 68500, total_price: 685000, delivery_days: 12, rating: 3.9 },
    vendor_explanation: "Zenvolt Technologies is recommended.",
    requested_amount: 685000,
    available_budget: 1200000,
    remaining_budget: 515000,
    recommendation: "approve",
    triggered_rules: ["amount_above_human_approval_threshold"],
    assessment_summary: "Human review required.",
  },
};

/** Static workflow/agent metadata served by the synthetic API. Mirrors orchestration/graph.py and agents/*.py. */
import type { AgentDetail, AgentId, AgentListItem, WorkflowDefinition, WorkflowListItem } from "../types";
import { POLICY } from "./catalog";
import { inr } from "./engine";

export const WORKFLOW_ID = "procurement";

export const WORKFLOW_LIST: WorkflowListItem[] = [
  {
    id: WORKFLOW_ID,
    name: "Procurement approval",
    description:
      "Parses a purchase request, compares vendors, validates budget, applies approval policy and pauses for human review when policy requires it.",
    agent_count: 4,
  },
];

const AGENT_DESCRIPTIONS: Record<AgentId, string> = {
  request_agent: "Parses the natural-language purchase request into structured, validated requirements.",
  vendor_agent: "Compares catalog vendors for the requested product and recommends the best eligible one.",
  budget_agent: "Validates the recommended vendor's cost against the department budget and the request's maximum.",
  approval_agent: "Applies approval policy and recommends approve/reject; decides whether a human must review.",
};

export const WORKFLOW: WorkflowDefinition = {
  id: WORKFLOW_ID,
  name: "Procurement approval",
  nodes: [
    { id: "__start__", label: "Start", kind: "start" },
    { id: "init", label: "Orchestrator", kind: "orchestrator", description: "Initializes shared state and emits workflow_initialized." },
    { id: "request_agent", label: "Request Agent", kind: "agent", agent_id: "request_agent", description: AGENT_DESCRIPTIONS.request_agent },
    { id: "vendor_agent", label: "Vendor Agent", kind: "agent", agent_id: "vendor_agent", description: AGENT_DESCRIPTIONS.vendor_agent },
    { id: "budget_agent", label: "Budget Agent", kind: "agent", agent_id: "budget_agent", description: AGENT_DESCRIPTIONS.budget_agent },
    { id: "approval_agent", label: "Approval Agent", kind: "agent", agent_id: "approval_agent", description: AGENT_DESCRIPTIONS.approval_agent },
    { id: "human_review", label: "Human Review", kind: "human", description: "Pauses the graph with interrupt() until a person approves or rejects." },
    { id: "finalize", label: "Final Report", kind: "report", description: "Decides the outcome and builds the deterministic procurement report." },
    { id: "__end__", label: "End", kind: "end" },
  ],
  edges: [
    ["__start__", "init", false, null],
    ["init", "request_agent", false, null],
    ["request_agent", "vendor_agent", true, "valid"],
    ["request_agent", "finalize", true, "invalid"],
    ["vendor_agent", "budget_agent", false, null],
    ["budget_agent", "approval_agent", false, null],
    ["approval_agent", "human_review", true, "approval required"],
    ["approval_agent", "finalize", true, "no approval required"],
    ["human_review", "finalize", false, "decision received"],
    ["finalize", "__end__", false, null],
  ].map(([source, target, conditional, label]) => ({
    id: `${source}->${target}`,
    source: source as string,
    target: target as string,
    conditional: conditional as boolean,
    label: label as string | null,
  })),
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_vendors: "List catalog vendors for a product.",
  get_department_budget: "Look up a department's available budget.",
  calculate_budget_check: "Compare a requested amount against an available budget.",
  evaluate_policy: "Apply approval policy rules to a purchase amount.",
};

const TOOLS: Record<AgentId, string[]> = {
  request_agent: [],
  vendor_agent: ["get_vendors"],
  budget_agent: ["get_department_budget", "calculate_budget_check"],
  approval_agent: ["evaluate_policy"],
};

const NAMES: Record<AgentId, string> = {
  request_agent: "Request Agent",
  vendor_agent: "Vendor Agent",
  budget_agent: "Budget Agent",
  approval_agent: "Approval Agent",
};

const RESPONSIBILITIES: Record<AgentId, string[]> = {
  request_agent: [
    "Extract department, product, quantity and maximum budget from the request text",
    "Handle Indian amount formats (₹8,00,000, 8 lakh, 1.2 crore)",
    "Validate quantity range, budget, known department and catalog product",
    "Mark the request invalid and list missing fields when it cannot proceed",
  ],
  vendor_agent: [
    "Fetch vendors for the product via the get_vendors tool",
    "Compute total price per vendor and filter to those within the maximum budget",
    "Score eligible vendors on price (60%), delivery (25%) and rating (15%)",
    "Recommend the highest-scoring vendor and explain the choice",
  ],
  budget_agent: [
    "Look up the department's available budget",
    "Check the requested amount against the available budget and the maximum budget",
    "Compute the remaining budget",
    "Skip validation when no vendor was recommended",
  ],
  approval_agent: [
    `Require human approval for amounts above ${inr(POLICY.HUMAN_APPROVAL_THRESHOLD_INR)}`,
    `Require human approval when less than ${Math.round(POLICY.LOW_REMAINING_BUDGET_RATIO * 100)}% of the budget would remain`,
    "Auto-reject when budget validation was rejected or skipped",
    "Recommend only; a human decision is final when review is required",
  ],
};

const LLM_USAGE: Record<AgentId, string> = {
  request_agent: "Field extraction in llm mode (validated against a JSON schema); rule parser in demo mode. The synthetic engine always uses the rule parser.",
  vendor_agent: "Explanation prose only in llm mode; scoring is deterministic Python (ported to TypeScript in the synthetic engine).",
  budget_agent: "Nothing; pure arithmetic in every mode.",
  approval_agent: "Summary prose only in llm mode; policy rules are deterministic.",
};

const str = { type: "string" };
const strN = { anyOf: [{ type: "string" }, { type: "null" }] };
const intN = { anyOf: [{ type: "integer" }, { type: "null" }] };
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });

const PARSED = obj({ department: strN, product: strN, quantity: intN, maximum_budget: intN, status: { enum: ["valid", "invalid"] }, missing_fields: { type: "array", items: str }, reason: strN }, ["status"]);
const QUOTE = obj({ vendor_id: str, name: str, unit_price: { type: "integer" }, total_price: { type: "integer" }, delivery_days: { type: "integer" }, rating: { type: "number" }, score: { anyOf: [{ type: "number" }, { type: "null" }] }, within_budget: { type: "boolean" } }, ["vendor_id", "name", "unit_price", "total_price", "delivery_days", "rating", "within_budget"]);
const VENDOR_EVAL = obj({ candidates: { type: "array", items: QUOTE }, recommended_vendor_id: strN, explanation: str });
const BUDGET_VAL = obj({ requested_amount: intN, available_budget: intN, remaining_budget: intN, status: { enum: ["approved", "rejected", "skipped"] }, reason: str });
const ASSESSMENT = obj({ approval_required: { type: "boolean" }, recommendation: { enum: ["approve", "reject"] }, triggered_rules: { type: "array", items: str }, summary: str });

const SCHEMAS: Record<AgentId, { input: object; output: object }> = {
  request_agent: { input: obj({ raw_request: str }), output: PARSED },
  vendor_agent: { input: obj({ parsed_request: PARSED }), output: VENDOR_EVAL },
  budget_agent: { input: obj({ parsed_request: PARSED, vendor_evaluation: VENDOR_EVAL }), output: BUDGET_VAL },
  approval_agent: { input: obj({ parsed_request: PARSED, vendor_evaluation: VENDOR_EVAL, budget_validation: BUDGET_VAL }), output: ASSESSMENT },
};

export const AGENT_LIST: AgentListItem[] = (Object.keys(NAMES) as AgentId[]).map((id) => ({
  id,
  name: NAMES[id],
  description: AGENT_DESCRIPTIONS[id],
  tools: TOOLS[id],
}));

export function agentDetail(id: string): AgentDetail | null {
  if (!(id in NAMES)) return null;
  const a = id as AgentId;
  return {
    id: a,
    name: NAMES[a],
    description: AGENT_DESCRIPTIONS[a],
    responsibilities: RESPONSIBILITIES[a],
    tools: TOOLS[a].map((t) => ({ name: t, description: TOOL_DESCRIPTIONS[t] })),
    llm_usage: LLM_USAGE[a],
    input_schema: SCHEMAS[a].input as Record<string, unknown>,
    output_schema: SCHEMAS[a].output as Record<string, unknown>,
  };
}

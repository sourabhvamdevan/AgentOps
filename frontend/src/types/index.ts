// Mirrors backend schemas (backend/app/schemas). Keep in sync.

export type ExecutionMode = "demo" | "llm";
export type ExecutionStatus = "created" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
export type Outcome = "approved" | "rejected" | "failed_validation" | "error";
export type AgentStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type AgentId = "request_agent" | "vendor_agent" | "budget_agent" | "approval_agent";

export const AGENT_IDS: AgentId[] = ["request_agent", "vendor_agent", "budget_agent", "approval_agent"];
export const TERMINAL_STATUSES: ExecutionStatus[] = ["completed", "failed", "cancelled"];

export type EventType =
  | "workflow_initialized"
  | "agent_started"
  | "tool_invoked"
  | "tool_completed"
  | "agent_completed"
  | "agent_failed"
  | "branch_selected"
  | "approval_requested"
  | "approval_received"
  | "workflow_completed"
  | "workflow_failed";

export interface Health {
  status: string;
  execution_mode: ExecutionMode;
  llm_available: boolean;
  llm_model: string | null;
  demo_reset_enabled: boolean;
  data_source: string;
}

export interface ParsedRequest {
  department: string | null;
  product: string | null;
  quantity: number | null;
  maximum_budget: number | null;
  status: "valid" | "invalid";
  missing_fields: string[];
  reason: string | null;
}

export interface VendorQuote {
  vendor_id: string;
  name: string;
  unit_price: number;
  total_price: number;
  delivery_days: number;
  rating: number;
  score: number | null;
  within_budget: boolean;
}

export interface VendorEvaluation {
  candidates: VendorQuote[];
  recommended_vendor_id: string | null;
  explanation: string;
}

export interface BudgetValidation {
  requested_amount: number | null;
  available_budget: number | null;
  remaining_budget: number | null;
  status: "approved" | "rejected" | "skipped";
  reason: string;
}

export interface ApprovalAssessment {
  approval_required: boolean;
  recommendation: "approve" | "reject";
  triggered_rules: string[];
  summary: string;
}

export interface ErrorRecord {
  class: string;
  message: string;
  agent_id: string | null;
  retryable: boolean;
  details?: unknown;
}

export interface ApprovalSummary {
  department: string;
  product: string;
  quantity: number;
  maximum_budget: number;
  vendor: { vendor_id: string; name: string; unit_price: number; total_price: number; delivery_days: number; rating: number };
  vendor_explanation: string;
  requested_amount: number;
  available_budget: number;
  remaining_budget: number;
  recommendation: "approve" | "reject";
  triggered_rules: string[];
  assessment_summary: string;
}

export interface Approval {
  id: string;
  execution_id: string;
  status: "pending" | "approved" | "rejected";
  summary: ApprovalSummary;
  decision_comment: string | null;
  requested_at: string;
  decided_at: string | null;
}

export interface ProcurementReport {
  execution_id: string;
  outcome: Outcome;
  execution_mode: ExecutionMode;
  reason: string | null;
  request_summary: { department: string | null; product: string | null; quantity: number | null; maximum_budget: number | null } | null;
  recommended_vendor: { vendor_id: string; name: string; unit_price: number; total_price: number; delivery_days: number } | null;
  vendor_comparison: VendorQuote[] | null;
  budget: { requested_amount: number | null; available_budget: number | null; remaining_budget: number | null; status: string } | null;
  approval: {
    required: boolean;
    recommendation: string | null;
    decision: string | null;
    decided_by: string | null;
    comment: string | null;
    triggered_rules: string[];
  } | null;
  timeline_summary: { started_at: string | null; completed_at: string | null; agents_run: number };
  data_source: string;
  disclaimer: string;
}

export interface ExecutionSummary {
  id: string;
  status: ExecutionStatus;
  execution_mode: ExecutionMode;
  raw_request: string;
  current_stage: string | null;
  outcome: Outcome | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface AgentExecution {
  id: string;
  agent_id: AgentId;
  status: AgentStatus;
  input: unknown;
  output: unknown;
  error: ErrorRecord | null;
  attempt: number;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface ExecutionDetail extends ExecutionSummary {
  error: ErrorRecord | null;
  agent_statuses: Record<AgentId, AgentStatus>;
  agent_executions: AgentExecution[];
  approval: Approval | null;
  report: ProcurementReport | null;
  parsed_request: ParsedRequest | null;
  vendor_evaluation: VendorEvaluation | null;
  budget_validation: BudgetValidation | null;
  approval_assessment: ApprovalAssessment | null;
}

export interface ExecutionEvent {
  id: string;
  execution_id: string;
  sequence: number;
  agent_id: string | null;
  event_type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;
  label: string;
  kind: "start" | "end" | "orchestrator" | "agent" | "human" | "report" | "node";
  agent_id?: AgentId;
  description?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  conditional: boolean;
  label: string | null;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowListItem {
  id: string;
  name: string;
  description: string;
  agent_count: number;
}

export interface AgentListItem {
  id: AgentId;
  name: string;
  description: string;
  tools: string[];
}

export interface AgentDetail {
  id: AgentId;
  name: string;
  description: string;
  responsibilities: string[];
  tools: { name: string; description: string }[];
  llm_usage: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type StreamMessage =
  | { type: "event"; event: ExecutionEvent }
  | { type: "closed"; status: string }
  | { type: "error"; error: { code: string; message: string } };

// ---- Workflow Monitor (GET /monitor/summary) ----

export interface AgentHealth {
  agent_id: AgentId;
  runs: number;
  completed: number;
  failed: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
}

export interface MonitorBucket {
  bucket_start: string;
  total: number;
  approved: number;
  rejected: number;
  failed_validation: number;
  error: number;
}

export interface PendingApproval {
  approval_id: string;
  execution_id: string;
  requested_at: string;
  age_seconds: number;
  requested_amount: number | null;
  department: string | null;
  product: string | null;
  vendor: string | null;
}

export interface RecentFailure {
  execution_id: string;
  at: string | null;
  agent_id: string | null;
  error_class: string;
  message: string;
  retryable: boolean;
}

export interface MonitorSummary {
  generated_at: string;
  data_source: string;
  totals: { executions: number; running: number; waiting_for_approval: number; completed: number; failed: number };
  outcomes: Record<Outcome, number>;
  rates: {
    completion_rate: number | null;
    failure_rate: number | null;
    approval_rate: number | null;
    auto_resolution_rate: number | null;
  };
  duration_ms: { avg: number | null; p50: number | null; p95: number | null };
  approval_wait_ms: { avg: number | null; max: number | null };
  agents: AgentHealth[];
  stages: { stage: string; label: string; reached: number }[];
  throughput: MonitorBucket[];
  pending_approvals: PendingApproval[];
  recent_failures: RecentFailure[];
  active: ExecutionSummary[];
}

import type { AgentExecution, Approval, ErrorRecord, ExecutionEvent, ExecutionStatus, Outcome, ProcurementReport } from "../types";
import type { State } from "./engine";

/** In-memory mirror of what the backend keeps in SQLite for one execution. */
export interface ExecRecord {
  id: string;
  raw_request: string;
  execution_mode: "demo";
  status: ExecutionStatus;
  current_stage: string | null;
  outcome: Outcome | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  error: ErrorRecord | null;
  agent_executions: AgentExecution[];
  approval: Approval | null;
  report: ProcurementReport | null;
  events: ExecutionEvent[];
  state: State;
  idempotency_key?: string | null;
}

export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
  rand(): number;
}

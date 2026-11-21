/**
 * Synthetic runtime: an in-browser stand-in for the AgentOps backend.
 *
 * It runs the same four-agent procurement workflow (using the ported deterministic logic in engine.ts),
 * emits the same event stream (persist-then-publish, monotonic sequence), pauses for human approval,
 * and keeps its state in localStorage so a page refresh behaves like the real backend.
 */
import type {
  AgentExecution,
  AgentId,
  AgentStatus,
  Approval,
  EventType,
  ExecutionDetail,
  ExecutionEvent,
  ExecutionSummary,
  Health,
  MonitorSummary,
  Page,
  StreamMessage,
} from "../types";
import { AGENT_IDS, TERMINAL_STATUSES } from "../types";
import {
  approvalSummary,
  assessApproval,
  buildReport,
  decideOutcome,
  evaluatePolicy,
  explainAfterApproval,
  explainAfterRequest,
  explainVendor,
  FAILURE_TRIGGER,
  getDepartmentBudget,
  getVendors,
  parseRequest,
  routeAfterApproval,
  routeAfterRequest,
  scoreVendors,
  SIMULATED_FAILURE,
  validateBudget,
  calculateBudgetCheck,
} from "./engine";
import { buildMonitorSummary, toSummary } from "./monitor";
import type { Clock, ExecRecord } from "./records";
import { SEED_RUNS } from "./seedRuns";

const STORAGE_KEY = "agentops.synthetic.v1";
const MAX_RECORDS = 40;

export class StoreError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

class Aborted extends Error {}
class AgentFailure extends Error {
  constructor(public record: import("../types").ErrorRecord) {
    super(record.message);
  }
}

const uuid = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

const iso = (d: Date) => d.toISOString();
const realClock: Clock = { now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), rand: Math.random };

function summarize(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} item(s)`;
  if (result && typeof result === "object")
    return Object.entries(result as Record<string, unknown>)
      .slice(0, 4)
      .map(([k, v]) => `${k}=${v === true ? "True" : v === false ? "False" : v}`)
      .join(", ");
  return String(result).slice(0, 120);
}

export interface StoreOptions {
  persist?: boolean;
  seed?: boolean;
  /** Scales every simulated delay; tests use 0. */
  speed?: number;
}

export class SyntheticStore {
  private records = new Map<string, ExecRecord>();
  private listeners = new Map<string, Set<(m: StreamMessage) => void>>();
  private gen = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  readonly ready: Promise<void>;

  constructor(private opts: StoreOptions = {}) {
    this.opts = { persist: true, seed: true, speed: 1, ...opts };
    this.ready = this.init();
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  private async init(): Promise<void> {
    const loaded = this.opts.persist ? this.load() : null;
    if (loaded) {
      for (const r of loaded) this.records.set(r.id, r);
      this.recoverOrphans();
    } else if (this.opts.seed) {
      await this.seedHistory();
    }
  }

  private load(): ExecRecord[] | null {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { v: number; records: ExecRecord[] };
      return parsed.v === 1 && Array.isArray(parsed.records) ? parsed.records : null;
    } catch {
      return null;
    }
  }

  private persistSoon() {
    if (!this.opts.persist || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        const recs = [...this.records.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, MAX_RECORDS);
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, records: recs }));
      } catch {
        /* storage full or unavailable: the in-memory store keeps working */
      }
    }, 250);
  }

  /** Same rule as the backend's recover_on_startup: runs interrupted by a restart become failed. */
  private recoverOrphans() {
    const clock = realClock;
    for (const r of this.records.values()) {
      if (r.status !== "created" && r.status !== "running") continue;
      const err = { class: "InternalError", message: "interrupted by restart", agent_id: null, retryable: false, details: null };
      const now = iso(clock.now());
      r.status = "failed";
      r.outcome = "error";
      r.error = err;
      r.completed_at = now;
      this.emit(r, clock, "workflow_failed", null, { error: err });
    }
  }

  // ---- reads -----------------------------------------------------------------------------------

  health(): Health {
    return {
      status: "ok",
      execution_mode: "demo",
      llm_available: false,
      llm_model: null,
      demo_reset_enabled: true,
      data_source: "synthetic-offline",
    };
  }

  list(limit: number, offset: number): Page<ExecutionSummary> {
    const all = [...this.records.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { items: all.slice(offset, offset + limit).map(toSummary), total: all.length, limit, offset };
  }

  get(id: string): ExecRecord {
    const r = this.records.get(id);
    if (!r) throw new StoreError(404, "not_found", `Execution '${id}' not found`);
    return r;
  }

  detail(id: string): ExecutionDetail {
    const r = this.get(id);
    const terminal = TERMINAL_STATUSES.includes(r.status);
    const latest = new Map<AgentId, AgentExecution>();
    for (const a of r.agent_executions) latest.set(a.agent_id, a);
    const statuses = Object.fromEntries(
      AGENT_IDS.map((a) => [a, (latest.get(a)?.status ?? (terminal ? "skipped" : "pending")) as AgentStatus]),
    ) as Record<AgentId, AgentStatus>;
    const out = (a: AgentId) => {
      const row = latest.get(a);
      return row && row.status === "completed" ? row.output : null;
    };
    return {
      ...toSummary(r),
      error: r.error,
      agent_statuses: statuses,
      agent_executions: r.agent_executions,
      approval: r.approval,
      report: r.report,
      parsed_request: out("request_agent") as ExecutionDetail["parsed_request"],
      vendor_evaluation: out("vendor_agent") as ExecutionDetail["vendor_evaluation"],
      budget_validation: out("budget_agent") as ExecutionDetail["budget_validation"],
      approval_assessment: out("approval_agent") as ExecutionDetail["approval_assessment"],
    };
  }

  events(id: string, after = 0): ExecutionEvent[] {
    return this.get(id).events.filter((e) => e.sequence > after);
  }

  approvals(status?: string | null): Approval[] {
    return [...this.records.values()]
      .map((r) => r.approval)
      .filter((a): a is Approval => !!a && (!status || a.status === status))
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  }

  monitor(now: Date = new Date()): MonitorSummary {
    return buildMonitorSummary([...this.records.values()], now, "synthetic-offline");
  }

  /** Mirrors the WebSocket: replay persisted events after `after`, then stream live ones. */
  stream(id: string, after: number, onMessage: (m: StreamMessage) => void, onOpen?: () => void): () => void {
    let closed = false;
    let off: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (closed) return;
      const r = this.records.get(id);
      onOpen?.();
      if (!r) {
        onMessage({ type: "error", error: { code: "not_found", message: "Execution not found" } });
        return;
      }
      let last = after;
      for (const e of r.events.filter((e) => e.sequence > after)) {
        onMessage({ type: "event", event: e });
        last = e.sequence;
      }
      if (TERMINAL_STATUSES.includes(r.status)) {
        onMessage({ type: "closed", status: r.status });
        return;
      }
      const handler = (m: StreamMessage) => {
        if (m.type === "event" && m.event.sequence <= last) return;
        if (m.type === "event") last = m.event.sequence;
        onMessage(m);
      };
      let set = this.listeners.get(id);
      if (!set) this.listeners.set(id, (set = new Set()));
      set.add(handler);
      off = () => set!.delete(handler);
    }, 0);
    return () => {
      closed = true;
      clearTimeout(timer);
      off?.();
    };
  }

  // ---- writes ------------------------------------------------------------------------------------

  create(raw: string, idempotencyKey?: string | null, clock: Clock = this.clock()): { record: ExecRecord; created: boolean; done: Promise<void> } {
    const request = raw.trim();
    if (request.length < 10 || request.length > 500)
      throw new StoreError(422, "validation_error", "Request validation failed", [
        { loc: ["body", "request"], msg: "request must be between 10 and 500 characters after trimming", type: "value_error" },
      ]);
    if (idempotencyKey) {
      const existing = [...this.records.values()].find((r) => r.idempotency_key === idempotencyKey);
      if (existing) return { record: existing, created: false, done: Promise.resolve() };
    }
    const now = iso(clock.now());
    const record: ExecRecord = {
      id: uuid(),
      raw_request: request,
      execution_mode: "demo",
      status: "created",
      current_stage: null,
      outcome: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      error: null,
      agent_executions: [],
      approval: null,
      report: null,
      events: [],
      state: {},
      idempotency_key: idempotencyKey ?? null,
    };
    this.records.set(record.id, record);
    this.persistSoon();
    // Start on the next tick so the POST response still reports status "created", like the real backend.
    const gen = this.gen;
    const done = Promise.resolve().then(() => this.drive(record, clock, gen)).catch(() => undefined);
    return { record, created: true, done };
  }

  async decide(approvalId: string, decision: "approve" | "reject", comment: string | null, clock: Clock = this.clock()): Promise<Approval> {
    return (await this.decideInternal(approvalId, decision, comment, clock)).approval;
  }

  private async decideInternal(
    approvalId: string,
    decision: "approve" | "reject",
    comment: string | null,
    clock: Clock,
  ): Promise<{ approval: Approval; done: Promise<void> }> {
    const rec = [...this.records.values()].find((r) => r.approval?.id === approvalId);
    if (!rec || !rec.approval) throw new StoreError(404, "not_found", `Approval '${approvalId}' not found`);
    const approval = rec.approval;
    if (approval.status !== "pending") throw new StoreError(409, "conflict", `Approval '${approvalId}' was already decided (${approval.status})`);
    if (rec.status !== "waiting_for_approval") throw new StoreError(409, "conflict", `Execution is '${rec.status}', not waiting for approval`);
    const decidedAt = iso(clock.now());
    approval.status = decision === "approve" ? "approved" : "rejected";
    approval.decision_comment = comment || null;
    approval.decided_at = decidedAt;
    rec.status = "running";
    const human = { decision, decided_at: decidedAt, decided_by: "demo_user", comment: comment || null };
    rec.state.human_decision = human;
    this.emit(rec, clock, "approval_received", null, { approval_id: approvalId, ...human });
    const gen = this.gen;
    const done = (async () => {
      try {
        await this.sleep(clock, 250, 450);
        this.checkAlive(gen);
        this.finalize(rec, clock);
      } catch {
        /* aborted by reset */
      }
    })();
    return { approval, done };
  }

  async reset(): Promise<void> {
    this.gen += 1;
    this.records.clear();
    this.listeners.clear();
    if (this.opts.persist) {
      try {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    if (this.opts.seed) await this.seedHistory();
    this.persistSoon();
  }

  /** Fire several sample requests (staggered) so the Workflow Monitor has live traffic to show. */
  generateLoad(requests: string[]): void {
    requests.forEach((text, i) => setTimeout(() => this.create(text), i * 700));
  }

  // ---- workflow runner -----------------------------------------------------------------------------

  private clock(): Clock {
    return this.opts.speed === 1 ? realClock : { ...realClock, sleep: (ms) => realClock.sleep(ms * (this.opts.speed ?? 1)) };
  }

  private checkAlive(gen: number) {
    if (gen !== this.gen) throw new Aborted();
  }

  private async sleep(clock: Clock, lo: number, hi: number) {
    await clock.sleep(Math.round(lo + clock.rand() * (hi - lo)));
  }

  private emit(rec: ExecRecord, clock: Clock, type: EventType, agentId: string | null, data: Record<string, unknown>) {
    const ev: ExecutionEvent = {
      id: uuid(),
      execution_id: rec.id,
      sequence: rec.events.length + 1,
      agent_id: agentId,
      event_type: type,
      timestamp: iso(clock.now()),
      data,
    };
    rec.events.push(ev); // persisted first ...
    rec.updated_at = ev.timestamp;
    this.persistSoon();
    this.listeners.get(rec.id)?.forEach((l) => l({ type: "event", event: ev })); // ... then published
    if (type === "workflow_completed" || type === "workflow_failed") {
      const status = type === "workflow_completed" ? "completed" : "failed";
      this.listeners.get(rec.id)?.forEach((l) => l({ type: "closed", status }));
      this.listeners.delete(rec.id);
    }
  }

  private async agent<T>(
    rec: ExecRecord,
    clock: Clock,
    gen: number,
    agentId: AgentId,
    input: unknown,
    body: (call: <R>(tool: string, args: Record<string, unknown>, fn: () => R) => Promise<R>) => Promise<T> | T,
  ): Promise<T> {
    const startedAt = clock.now();
    const row: AgentExecution = {
      id: uuid(),
      agent_id: agentId,
      status: "running",
      input,
      output: null,
      error: null,
      attempt: 1,
      started_at: iso(startedAt),
      completed_at: null,
      duration_ms: null,
    };
    rec.agent_executions.push(row);
    rec.current_stage = agentId;
    this.emit(rec, clock, "agent_started", agentId, { input });
    await this.sleep(clock, 180, 380);
    this.checkAlive(gen);

    const call = async <R,>(tool: string, args: Record<string, unknown>, fn: () => R): Promise<R> => {
      this.emit(rec, clock, "tool_invoked", agentId, { tool, arguments: args });
      const t0 = clock.now().getTime();
      await this.sleep(clock, 90, 220);
      this.checkAlive(gen);
      const result = fn();
      this.emit(rec, clock, "tool_completed", agentId, {
        tool,
        result,
        result_summary: summarize(result),
        duration_ms: Math.max(1, clock.now().getTime() - t0),
      });
      return result;
    };

    try {
      const output = await body(call);
      await this.sleep(clock, 40, 120);
      this.checkAlive(gen);
      row.status = "completed";
      row.output = output;
      row.completed_at = iso(clock.now());
      row.duration_ms = clock.now().getTime() - startedAt.getTime();
      this.emit(rec, clock, "agent_completed", agentId, { output, duration_ms: row.duration_ms, attempt: 1 });
      this.persistSoon();
      return output;
    } catch (e) {
      if (e instanceof Aborted) throw e;
      const record = e instanceof AgentFailure ? e.record : { class: "InternalError", message: String((e as Error).message ?? e), agent_id: agentId, retryable: false, details: null };
      if (record.retryable) {
        // The real executor retries retryable errors twice with a growing backoff before giving up.
        for (const attempt of [1, 2]) {
          row.attempt = attempt + 1;
          await clock.sleep(500 * attempt);
          this.checkAlive(gen);
        }
      }
      row.status = "failed";
      row.error = record;
      row.completed_at = iso(clock.now());
      row.duration_ms = clock.now().getTime() - startedAt.getTime();
      this.emit(rec, clock, "agent_failed", agentId, { error: record, attempt: row.attempt, duration_ms: row.duration_ms });
      throw new AgentFailure(record);
    }
  }

  private async drive(rec: ExecRecord, clock: Clock, gen: number): Promise<void> {
    try {
      await this.start(rec, clock, gen);
    } catch (e) {
      if (e instanceof Aborted) return;
      const record = e instanceof AgentFailure ? e.record : { class: "InternalError", message: String((e as Error).message ?? e), agent_id: null, retryable: false, details: null };
      this.fail(rec, clock, record);
    }
  }

  private async start(rec: ExecRecord, clock: Clock, gen: number): Promise<void> {
    const alive = () => this.checkAlive(gen);
    const s = rec.state;
    rec.status = "running";
    rec.current_stage = "init";
    this.emit(rec, clock, "workflow_initialized", null, {
      workflow_id: "procurement",
      raw_request: rec.raw_request,
      execution_mode: "demo",
      agents: AGENT_IDS,
    });
    await this.sleep(clock, 120, 260);
    alive();

    // 1. Request Agent
    s.parsed_request = await this.agent(rec, clock, gen, "request_agent", { raw_request: rec.raw_request }, () => parseRequest(rec.raw_request));
    this.emit(rec, clock, "branch_selected", null, { from: "request_agent", branch: routeAfterRequest(s), reason: explainAfterRequest(s) });
    if (routeAfterRequest(s) === "finalize") return this.finalize(rec, clock);
    const req = s.parsed_request;

    // 2. Vendor Agent
    const injectFailure = FAILURE_TRIGGER.test(rec.raw_request);
    s.vendor_evaluation = await this.agent(rec, clock, gen, "vendor_agent", { parsed_request: req }, async (call) => {
      const vendors = await call("get_vendors", { product: req.product }, () => getVendors(req.product!));
      if (injectFailure) throw new AgentFailure({ ...SIMULATED_FAILURE });
      const { quotes, recommended } = scoreVendors(vendors, req.quantity!, req.maximum_budget!);
      return { candidates: quotes, recommended_vendor_id: recommended, explanation: explainVendor(req, quotes, recommended) };
    });
    const ev = s.vendor_evaluation;

    // 3. Budget Agent
    s.budget_validation = await this.agent(rec, clock, gen, "budget_agent", { parsed_request: req, vendor_evaluation: ev }, async (call) => {
      const budget = await call("get_department_budget", { department: req.department }, () => getDepartmentBudget(req.department!)!);
      if (ev.recommended_vendor_id !== null) {
        const quote = ev.candidates.find((q) => q.vendor_id === ev.recommended_vendor_id)!;
        await call("calculate_budget_check", { requested: quote.total_price, available: budget.available_budget }, () =>
          calculateBudgetCheck(quote.total_price, budget.available_budget),
        );
      }
      return validateBudget(req, ev, budget.available_budget);
    });
    const bv = s.budget_validation;

    // 4. Approval Agent
    s.approval_assessment = await this.agent(
      rec,
      clock,
      gen,
      "approval_agent",
      { parsed_request: req, vendor_evaluation: ev, budget_validation: bv },
      async (call) => {
        if (bv.status !== "approved") return assessApproval(bv, null);
        const policy = await call(
          "evaluate_policy",
          { requested_amount: bv.requested_amount, available_budget: bv.available_budget, remaining_budget: bv.remaining_budget },
          () => evaluatePolicy(bv.requested_amount!, bv.available_budget!, bv.remaining_budget!),
        );
        return assessApproval(bv, policy);
      },
    );
    this.emit(rec, clock, "branch_selected", null, { from: "approval_agent", branch: routeAfterApproval(s), reason: explainAfterApproval(s) });

    if (routeAfterApproval(s) === "finalize") return this.finalize(rec, clock);

    // 5. Human review: pause here until decide() is called. State is persisted, so this survives a refresh.
    const summary = approvalSummary(s);
    rec.approval = { id: uuid(), execution_id: rec.id, status: "pending", summary, decision_comment: null, requested_at: iso(clock.now()), decided_at: null };
    rec.status = "waiting_for_approval";
    rec.current_stage = "human_review";
    this.emit(rec, clock, "approval_requested", null, { approval_id: rec.approval.id, summary });
  }

  private agentStatuses(rec: ExecRecord): Record<AgentId, AgentStatus> {
    const latest = new Map<AgentId, AgentStatus>();
    for (const a of rec.agent_executions) latest.set(a.agent_id, a.status);
    return Object.fromEntries(AGENT_IDS.map((a) => [a, (latest.get(a) ?? "skipped") as AgentStatus])) as Record<AgentId, AgentStatus>;
  }

  private finalize(rec: ExecRecord, clock: Clock) {
    const outcome = decideOutcome(rec.state);
    const statuses = this.agentStatuses(rec);
    const now = iso(clock.now());
    rec.report = buildReport({
      executionId: rec.id,
      state: rec.state,
      outcome,
      startedAt: rec.created_at,
      completedAt: now,
      agentsRun: AGENT_IDS.filter((a) => statuses[a] === "completed" || statuses[a] === "failed").length,
    });
    rec.status = "completed";
    rec.outcome = outcome;
    rec.current_stage = "finalize";
    rec.completed_at = now;
    this.emit(rec, clock, "workflow_completed", null, { outcome, reason: rec.report.reason, agent_statuses: statuses });
  }

  private fail(rec: ExecRecord, clock: Clock, record: import("../types").ErrorRecord) {
    const statuses = this.agentStatuses(rec);
    if (record.agent_id) statuses[record.agent_id as AgentId] = "failed";
    const now = iso(clock.now());
    rec.report = buildReport({
      executionId: rec.id,
      state: rec.state,
      outcome: "error",
      startedAt: rec.created_at,
      completedAt: now,
      agentsRun: AGENT_IDS.filter((a) => statuses[a] === "completed" || statuses[a] === "failed").length,
      errorMessage: `${record.class}: ${record.message}`,
    });
    rec.status = "failed";
    rec.outcome = "error";
    rec.error = record;
    rec.completed_at = now;
    this.emit(rec, clock, "workflow_failed", record.agent_id, { error: record });
  }

  // ---- seeded history -----------------------------------------------------------------------------

  private async seedHistory(): Promise<void> {
    const gen = this.gen;
    const nowMs = Date.now();
    let prng = 1234567;
    const rand = () => {
      prng = (prng * 1664525 + 1013904223) % 4294967296;
      return prng / 4294967296;
    };
    for (const run of SEED_RUNS) {
      if (gen !== this.gen) return;
      let t = nowMs - run.hoursAgo * 3_600_000;
      const clock: Clock = {
        now: () => new Date(t),
        sleep: async (ms) => {
          t += ms;
        },
        rand,
      };
      const { record, done } = this.create(run.text, null, clock);
      await done; // the virtual clock resolves sleeps immediately, so this finishes without real waiting
      if (run.decision && record.approval?.status === "pending") {
        t += run.decision.afterMinutes * 60_000;
        const { done: resumed } = await this.decideInternal(record.approval.id, run.decision.verdict, run.decision.comment, clock);
        await resumed;
      }
    }
  }

}

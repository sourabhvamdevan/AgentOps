import { afterEach, describe, expect, it } from "vitest";

import { SyntheticStore } from "./store";

const SAMPLE = "Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.";
const AUTO = "Buy 2 monitors for the Finance department with a maximum budget of ₹50,000.";

const fresh = (opts = {}) => new SyntheticStore({ persist: false, seed: false, speed: 0, ...opts });

async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 2));
  }
}

const stores: SyntheticStore[] = [];
const make = (opts = {}) => {
  const s = fresh(opts);
  stores.push(s);
  return s;
};
afterEach(async () => {
  stores.length = 0;
});

describe("SyntheticStore workflow", () => {
  it("runs the sample request, pauses for a human, then completes on approval", async () => {
    const store = make();
    await store.ready;
    const { record } = store.create(SAMPLE);
    await until(() => record.status === "waiting_for_approval");

    const types = record.events.map((e) => e.event_type);
    expect(types[0]).toBe("workflow_initialized");
    expect(types.at(-1)).toBe("approval_requested");
    expect(types.filter((t) => t === "agent_started")).toHaveLength(4);
    expect(record.events.map((e) => e.sequence)).toEqual(record.events.map((_, i) => i + 1)); // monotonic, gap-free
    expect(record.approval?.summary.requested_amount).toBe(685000);
    expect(record.approval?.summary.vendor.name).toBe("Zenvolt Technologies");

    const detail = store.detail(record.id);
    expect(detail.status).toBe("waiting_for_approval");
    expect(detail.agent_statuses.approval_agent).toBe("completed");
    expect(detail.report).toBeNull();

    await store.decide(record.approval!.id, "approve", "Looks good");
    await until(() => record.status === "completed");
    expect(record.outcome).toBe("approved");
    expect(record.report?.approval).toMatchObject({ required: true, decision: "approved", decided_by: "demo_user", comment: "Looks good" });
    expect(record.events.at(-1)?.event_type).toBe("workflow_completed");
    expect(record.report?.disclaimer).toBe("All data is fictional. No real purchase was made.");
  });

  it("supports a human rejection", async () => {
    const store = make();
    const { record } = store.create(SAMPLE);
    await until(() => record.status === "waiting_for_approval");
    await store.decide(record.approval!.id, "reject", "Not now");
    await until(() => record.status === "completed");
    expect(record.outcome).toBe("rejected");
    expect(record.report?.reason).toBe("Rejected by human reviewer. Comment: Not now");
  });

  it("refuses a second decision with a 409", async () => {
    const store = make();
    const { record } = store.create(SAMPLE);
    await until(() => record.status === "waiting_for_approval");
    const id = record.approval!.id;
    await store.decide(id, "approve", null);
    await expect(store.decide(id, "reject", null)).rejects.toMatchObject({ status: 409, code: "conflict" });
    await expect(store.decide("nope", "approve", null)).rejects.toMatchObject({ status: 404 });
  });

  it("auto-approves a request inside policy without a human", async () => {
    const store = make();
    const { record } = store.create(AUTO);
    await until(() => record.status === "completed");
    expect(record.outcome).toBe("approved");
    expect(record.approval).toBeNull();
    expect(record.report?.approval).toMatchObject({ required: false, decided_by: "policy (automatic)" });
    expect(store.detail(record.id).agent_statuses).toMatchObject({ request_agent: "completed", approval_agent: "completed" });
  });

  it("auto-rejects over-budget and no-vendor requests", async () => {
    const store = make();
    const over = store.create("Purchase 20 laptops for the engineering department with a maximum budget of ₹20,00,000.").record;
    const none = store.create("Purchase 5 laptops for the marketing department with a maximum budget of ₹1,00,000.").record;
    await until(() => over.status === "completed" && none.status === "completed");
    expect(over.outcome).toBe("rejected");
    expect(over.report?.reason).toContain("exceeds the Engineering available budget");
    expect(none.outcome).toBe("rejected");
    expect(store.detail(none.id).budget_validation?.status).toBe("skipped");
  });

  it("fails validation for a vague request and skips the other agents", async () => {
    const store = make();
    const { record } = store.create("buy some stuff");
    await until(() => record.status === "completed");
    expect(record.outcome).toBe("failed_validation");
    const d = store.detail(record.id);
    expect(d.agent_statuses).toEqual({ request_agent: "completed", vendor_agent: "skipped", budget_agent: "skipped", approval_agent: "skipped" });
  });

  it("injects a retryable vendor-agent failure for the fault simulator", async () => {
    const store = make();
    const { record } = store.create("Purchase 4 laptops for the HR department with a maximum budget of ₹4,00,000. simulate failure");
    await until(() => record.status === "failed");
    expect(record.outcome).toBe("error");
    expect(record.error).toMatchObject({ class: "ToolTimeoutError", agent_id: "vendor_agent", retryable: true });
    const types = record.events.map((e) => e.event_type);
    expect(types.slice(-2)).toEqual(["agent_failed", "workflow_failed"]);
    expect(types).not.toContain("workflow_completed");
    expect(record.agent_executions.find((a) => a.agent_id === "vendor_agent")?.attempt).toBe(3);
    expect(record.report?.outcome).toBe("error");
  });

  it("is idempotent for a repeated key and validates request length", async () => {
    const store = make();
    const a = store.create(AUTO, "key-1");
    const b = store.create(AUTO, "key-1");
    expect(b.created).toBe(false);
    expect(b.record.id).toBe(a.record.id);
    expect(() => store.create("short")).toThrowError(/Request validation failed/);
  });

  it("replays persisted events after a sequence, then streams live ones", async () => {
    const store = make();
    const { record } = store.create(AUTO);
    await until(() => record.events.length >= 3);
    const seen: number[] = [];
    let closed: string | null = null;
    store.stream(record.id, 2, (m) => {
      if (m.type === "event") seen.push(m.event.sequence);
      if (m.type === "closed") closed = m.status;
    });
    await until(() => closed !== null);
    expect(seen[0]).toBe(3);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(closed).toBe("completed");
  });

  it("answers 404 for unknown executions", async () => {
    const store = make();
    expect(() => store.detail("missing")).toThrowError(/not found/);
  });
});

describe("seeded history", () => {
  it("creates a realistic spread of outcomes, a failure, and a pending approval", async () => {
    const store = make({ seed: true });
    await store.ready;
    const m = store.monitor();
    expect(m.totals.executions).toBe(16);
    expect(m.outcomes.approved).toBeGreaterThan(0);
    expect(m.outcomes.rejected).toBeGreaterThan(0);
    expect(m.outcomes.failed_validation).toBeGreaterThan(0);
    expect(m.outcomes.error).toBe(1);
    expect(m.totals.waiting_for_approval).toBe(1);
    expect(m.pending_approvals[0].age_seconds).toBeGreaterThan(3600); // old enough to trigger the stale-approval alert
    expect(m.recent_failures[0]).toMatchObject({ error_class: "ToolTimeoutError", retryable: true });
    expect(m.throughput).toHaveLength(24);
    expect(m.throughput.reduce((n, b) => n + b.total, 0)).toBe(16);
    expect(m.agents.find((a) => a.agent_id === "vendor_agent")!.failed).toBe(1);
  });

  it("reset wipes live data and regenerates the seeded history", async () => {
    const store = make({ seed: true });
    await store.ready;
    store.create(AUTO);
    expect(store.list(100, 0).total).toBe(17);
    await store.reset();
    expect(store.list(100, 0).total).toBe(16);
  });
});

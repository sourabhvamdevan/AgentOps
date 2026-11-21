import { describe, expect, it } from "vitest";

import { deriveAlerts } from "../pages/monitorAlerts";
import { buildMonitorSummary, percentile } from "./monitor";
import { SyntheticStore } from "./store";

describe("percentile", () => {
  it("uses nearest-rank", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});

describe("buildMonitorSummary", () => {
  it("is well-formed for an empty system", () => {
    const m = buildMonitorSummary([], new Date());
    expect(m.totals.executions).toBe(0);
    expect(m.rates.approval_rate).toBeNull();
    expect(m.duration_ms.avg).toBeNull();
    expect(m.throughput).toHaveLength(24);
    expect(m.agents.map((a) => a.runs)).toEqual([0, 0, 0, 0]);
    expect(deriveAlerts(m).map((a) => a.level)).toEqual(["info"]);
  });

  it("computes rates, funnel and alerts from seeded history", async () => {
    const store = new SyntheticStore({ persist: false, seed: true, speed: 0 });
    await store.ready;
    const m = store.monitor();
    const finished = m.totals.completed + m.totals.failed;
    expect(m.rates.completion_rate).toBeCloseTo(m.totals.completed / finished, 2);
    expect(m.rates.failure_rate).toBeCloseTo(m.totals.failed / finished, 2);
    expect(m.rates.approval_rate).toBeCloseTo(m.outcomes.approved / (m.outcomes.approved + m.outcomes.rejected), 2);

    const reached = Object.fromEntries(m.stages.map((s) => [s.stage, s.reached]));
    expect(reached.submitted).toBe(16);
    expect(reached.request_agent).toBe(16);
    expect(reached.vendor_agent).toBeLessThan(reached.request_agent); // invalid requests never reach the vendor agent
    expect(reached.human_review).toBe(4);
    expect(reached.finalized).toBe(m.totals.completed);

    const levels = deriveAlerts(m).map((a) => a.level);
    expect(levels).toContain("critical"); // the injected vendor-agent failure
    expect(levels).toContain("warning"); // the approval waiting > 1h
    expect(levels).not.toContain("info");
  });
});

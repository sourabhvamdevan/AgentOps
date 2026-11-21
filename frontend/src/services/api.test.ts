import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __setSyntheticStore } from "../synthetic/router";
import { SyntheticStore } from "../synthetic/store";
import { __resetConnectionForTests, getConnection } from "./connection";

const HEALTH = { status: "ok", execution_mode: "demo", llm_available: false, llm_model: null, demo_reset_enabled: true, data_source: "synthetic" };

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

async function loadApi() {
  vi.resetModules(); // api.ts keeps its probe promise at module level
  return import("./api");
}

beforeEach(() => {
  __setSyntheticStore(new SyntheticStore({ persist: false, seed: true, speed: 0 }));
  __resetConnectionForTests("probing", "auto");
});
afterEach(() => {
  vi.unstubAllGlobals();
  __setSyntheticStore(null);
});

describe("API with synthetic fallback", () => {
  it("uses the real backend when it is healthy", async () => {
    const fetchMock = vi.fn((url: string) => (url.endsWith("/health") ? json(HEALTH) : json({ items: [{ id: "live-workflow" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await loadApi();
    const { getConnection: conn } = await import("./connection");
    const res = await api.workflows();
    expect((res.items[0] as { id: string }).id).toBe("live-workflow");
    expect(conn().mode).toBe("live");
  });

  it("falls back to synthetic data when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const { api } = await loadApi();
    const { getConnection: conn } = await import("./connection");
    const wf = await api.workflows();
    expect(wf.items[0].id).toBe("procurement");
    expect(conn().mode).toBe("synthetic");
    expect(conn().reason).toMatch(/Cannot reach the backend/);
    const agents = await api.agents();
    expect(agents.items).toHaveLength(4);
    const graph = await api.workflow("procurement");
    expect(graph.nodes.map((n) => n.id)).toContain("human_review");
  });

  it("falls back when the host answers with HTML instead of the API (static hosting)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("<!doctype html><html></html>", { status: 200, headers: { "Content-Type": "text/html" } }))));
    const { api } = await loadApi();
    const { getConnection: conn } = await import("./connection");
    expect((await api.health()).data_source).toBe("synthetic-offline");
    expect(conn().mode).toBe("synthetic");
  });

  it("falls back on a gateway error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({}, 502)));
    const { api } = await loadApi();
    expect((await api.executions(5)).items.length).toBe(5);
  });

  it("does not hide ordinary API errors from a healthy backend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => (url.endsWith("/health") ? json(HEALTH) : json({ error: { code: "not_found", message: "Execution 'x' not found" } }, 404))),
    );
    const { api } = await loadApi();
    await expect(api.execution("x")).rejects.toMatchObject({ status: 404, code: "not_found" });
    const { getConnection: conn } = await import("./connection");
    expect(conn().mode).toBe("live");
  });

  it("runs a full synthetic request/approval round-trip through the API surface", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const { api } = await loadApi();
    const created = await api.createExecution("Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.", "k1");
    expect(created.status).toBe("created");
    let detail = await api.execution(created.id);
    for (let i = 0; i < 400 && detail.status !== "waiting_for_approval"; i++) {
      await new Promise((r) => setTimeout(r, 5));
      detail = await api.execution(created.id);
    }
    expect(detail.status).toBe("waiting_for_approval");
    await api.decide(detail.approval!.id, "approve", "ok");
    for (let i = 0; i < 400 && detail.status !== "completed"; i++) {
      await new Promise((r) => setTimeout(r, 5));
      detail = await api.execution(created.id);
    }
    expect(detail.report?.outcome).toBe("approved");
    const summary = await api.monitorSummary();
    expect(summary.totals.executions).toBe(17);
    expect((await api.events(created.id, 3)).items[0].sequence).toBe(4);
  });

  it("reports unreachable backend state through the connection store", () => {
    expect(getConnection().policy).toBe("auto");
  });
});

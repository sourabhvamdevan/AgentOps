import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConnectionBanner } from "../../components/ConnectionBanner";
import { __resetConnectionForTests } from "../../services/connection";
import { __setSyntheticStore } from "../../synthetic/router";
import { SyntheticStore } from "../../synthetic/store";
import { WorkflowMonitor } from "../WorkflowMonitor";

beforeEach(() => {
  __setSyntheticStore(new SyntheticStore({ persist: false, seed: true, speed: 0 }));
  __resetConnectionForTests("synthetic", "auto");
});
afterEach(() => __setSyntheticStore(null));

describe("WorkflowMonitor (synthetic engine)", () => {
  it("renders KPIs, alerts, funnel, agent health and pending approvals from seeded data", async () => {
    render(
      <MemoryRouter>
        <ConnectionBanner />
        <WorkflowMonitor />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("monitor-alerts", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId("synthetic-banner")).toHaveTextContent("Synthetic data engine active");

    expect(screen.getByTestId("kpi-total-runs")).toHaveTextContent("16");
    const alerts = screen.getByTestId("monitor-alerts");
    expect(within(alerts).getByText(/1 execution failed/)).toBeInTheDocument();
    expect(within(alerts).getByText(/Approval waiting too long/)).toBeInTheDocument();

    expect(screen.getByTestId("stage-submitted")).toHaveTextContent("16");
    expect(screen.getByTestId("agent-row-vendor_agent")).toBeInTheDocument();
    expect(within(screen.getByTestId("pending-approvals")).getAllByRole("link")).toHaveLength(1);
    expect(within(screen.getByTestId("recent-failures")).getByText("ToolTimeoutError")).toBeInTheDocument();
    expect(screen.getByTestId("generate-load")).toBeInTheDocument();
  });
});

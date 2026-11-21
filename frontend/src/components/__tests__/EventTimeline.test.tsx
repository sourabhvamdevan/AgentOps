import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EventTimeline } from "../EventTimeline";
import { ev } from "./fixtures";

describe("EventTimeline", () => {
  it("shows an empty state", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/No events yet/)).toBeInTheDocument();
  });

  it("renders events in order with readable summaries", () => {
    const events = [
      ev(1, "workflow_initialized", null, { execution_mode: "demo" }),
      ev(2, "agent_completed", "request_agent", {
        output: { status: "valid", quantity: 10, product: "laptop", department: "Engineering", maximum_budget: 800000 },
      }),
      ev(3, "approval_requested", null, { summary: { requested_amount: 685000 } }),
      ev(4, "workflow_failed", null, { error: { class: "LLMTimeoutError", message: "timed out" } }),
    ];
    render(<EventTimeline events={events} />);
    const items = screen.getAllByTestId("timeline-event");
    expect(items.map((i) => i.getAttribute("data-event-type"))).toEqual([
      "workflow_initialized",
      "agent_completed",
      "approval_requested",
      "workflow_failed",
    ]);
    expect(screen.getByText("Workflow started in demo mode")).toBeInTheDocument();
    expect(screen.getByText("Parsed: 10 × laptop, Engineering, max ₹8,00,000")).toBeInTheDocument();
    expect(screen.getByText("Waiting for human approval of ₹6,85,000")).toBeInTheDocument();
    expect(screen.getByText(/LLMTimeoutError: timed out/)).toBeInTheDocument();
    expect(screen.getByText("Request Agent")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked event", async () => {
    const onSelect = vi.fn();
    const events = [ev(1, "workflow_initialized", null, { execution_mode: "demo" }), ev(2, "agent_started", "vendor_agent")];
    render(<EventTimeline events={events} onSelect={onSelect} />);
    await userEvent.click(screen.getAllByTestId("timeline-event")[1]);
    expect(onSelect).toHaveBeenCalledWith(events[1]);
  });
});

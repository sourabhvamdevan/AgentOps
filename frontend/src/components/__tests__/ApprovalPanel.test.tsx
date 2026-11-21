import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApprovalPanel } from "../ApprovalPanel";
import { approval } from "./fixtures";

describe("ApprovalPanel", () => {
  it("shows purchase details, amounts and triggered rules", () => {
    render(<ApprovalPanel approval={approval} onDecide={vi.fn()} />);
    expect(screen.getByText("10 × Laptop for Engineering")).toBeInTheDocument();
    expect(screen.getByText("₹6,85,000")).toBeInTheDocument();
    expect(screen.getByText("₹12,00,000")).toBeInTheDocument();
    expect(screen.getByText("Amount above human approval threshold")).toBeInTheDocument();
    expect(screen.getByText(/Zenvolt Technologies \(12-day delivery\)/)).toBeInTheDocument();
  });

  it("sends approve with the comment", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalPanel approval={approval} onDecide={onDecide} />);
    await userEvent.type(screen.getByLabelText("Decision comment"), "  looks fine ");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onDecide).toHaveBeenCalledWith("approve", "looks fine");
  });

  it("sends reject and surfaces errors", async () => {
    const onDecide = vi.fn().mockRejectedValue(new Error("Approval 'a1' was already decided"));
    render(<ApprovalPanel approval={approval} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onDecide).toHaveBeenCalledWith("reject", "");
    expect(await screen.findByRole("alert")).toHaveTextContent("already decided");
  });
});

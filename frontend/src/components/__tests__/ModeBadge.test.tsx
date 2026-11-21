import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModeBadge } from "../ModeBadge";

describe("ModeBadge", () => {
  it("labels demo mode without claiming LLM use", () => {
    render(<ModeBadge mode="demo" model="llama3.1:8b" />);
    const badge = screen.getByTestId("mode-badge");
    expect(badge).toHaveTextContent("Demo mode (deterministic rules)");
    expect(badge).not.toHaveTextContent(/LLM|llama/);
  });

  it("names the model in llm mode", () => {
    render(<ModeBadge mode="llm" model="llama3.1:8b" />);
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("LLM mode (model: llama3.1:8b)");
  });

  it("renders nothing without a mode", () => {
    const { container } = render(<ModeBadge mode={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

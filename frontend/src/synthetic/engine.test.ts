import { describe, expect, it } from "vitest";

import {
  assessApproval,
  decideOutcome,
  evaluatePolicy,
  getVendors,
  inr,
  parseBudget,
  parseRequest,
  scoreVendors,
  validateBudget,
} from "./engine";

describe("inr", () => {
  it("uses Indian digit grouping", () => {
    expect(inr(685000)).toBe("₹6,85,000");
    expect(inr(50000)).toBe("₹50,000");
    expect(inr(1_200_000)).toBe("₹12,00,000");
    expect(inr(999)).toBe("₹999");
  });
});

describe("parseBudget", () => {
  it.each([
    ["maximum budget of ₹8,00,000.", 800000],
    ["budget Rs 800000", 800000],
    ["INR 8 lakh", 800000],
    ["around 8L", 800000],
    ["up to 1.2 crore", 12_000_000],
    ["budget of 50000", 50000],
  ])("%s -> %i", (text, expected) => expect(parseBudget(text)).toBe(expected));

  it("returns null without an amount", () => expect(parseBudget("buy some stuff")).toBeNull());
});

describe("parseRequest (same scenarios as the backend suite)", () => {
  it("parses the sample request", () => {
    const p = parseRequest("Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.");
    expect(p).toMatchObject({ department: "Engineering", product: "laptop", quantity: 10, maximum_budget: 800000, status: "valid", reason: null });
  });

  it("does not mistake the budget for the quantity", () => {
    const p = parseRequest("Buy 2 monitors for the Finance department with a maximum budget of ₹50,000.");
    expect(p).toMatchObject({ department: "Finance", product: "monitor", quantity: 2, maximum_budget: 50000 });
  });

  it("flags a vague request with the missing fields", () => {
    const p = parseRequest("buy some stuff");
    expect(p.status).toBe("invalid");
    expect(p.missing_fields).toEqual(["department", "product", "quantity", "maximum_budget"]);
    expect(p.reason).toContain("missing:");
  });

  it("rejects an unknown product and an out-of-range quantity", () => {
    expect(parseRequest("Order 3 chairs for the HR department with a maximum budget of ₹50,000.").status).toBe("invalid");
    const big = parseRequest("Order 5000 laptops for the HR department with a maximum budget of ₹5,00,00,000.");
    expect(big.reason).toContain("quantity must be between 1 and 1000");
  });

  it("names but rejects an unknown department", () => {
    const p = parseRequest("Order 3 laptops for the legal department with a maximum budget of ₹5,00,000.");
    expect(p.department).toBe("Legal");
    expect(p.reason).toContain("unknown department 'Legal'");
  });
});

describe("vendor scoring", () => {
  it("recommends Zenvolt for 10 laptops under 8 lakh (matches the backend)", () => {
    const { quotes, recommended } = scoreVendors(getVendors("laptop"), 10, 800000);
    expect(recommended).toBe("v2");
    const v2 = quotes.find((q) => q.vendor_id === "v2")!;
    expect(v2.total_price).toBe(685000);
    expect(quotes.filter((q) => q.within_budget).map((q) => q.vendor_id).sort()).toEqual(["v1", "v2"]);
    expect(quotes[quotes.length - 1].within_budget).toBe(false); // ineligible quotes sort last
  });

  it("returns no recommendation when nothing fits", () => {
    expect(scoreVendors(getVendors("laptop"), 5, 100000).recommended).toBeNull();
  });

  it("handles a single eligible vendor (degenerate ranges)", () => {
    const { quotes, recommended } = scoreVendors(getVendors("monitor"), 14, 200000);
    expect(recommended).toBe("v6");
    // cost and delivery normalise to 0 and rating to 1 when the range is degenerate: 0.6 + 0.25 + 0.15
    expect(quotes.find((q) => q.vendor_id === "v6")!.score).toBe(1);
  });
});

describe("budget and policy", () => {
  it("requires approval above ₹5,00,000", () => {
    expect(evaluatePolicy(685000, 1_200_000, 515000)).toEqual({ approval_required: true, triggered_rules: ["amount_above_human_approval_threshold"] });
  });

  it("requires approval when under 10% of the budget would remain", () => {
    expect(evaluatePolicy(400000, 420000, 20000).triggered_rules).toEqual(["low_remaining_budget"]);
  });

  it("auto-approves inside every threshold", () => {
    expect(evaluatePolicy(26400, 600000, 573600).approval_required).toBe(false);
  });

  it("rejects a quote above the department budget and auto-rejects downstream", () => {
    const req = parseRequest("Purchase 20 laptops for the engineering department with a maximum budget of ₹20,00,000.");
    const { quotes, recommended } = scoreVendors(getVendors("laptop"), 20, 2_000_000);
    const bv = validateBudget(req, { candidates: quotes, recommended_vendor_id: recommended, explanation: "" }, 1_200_000);
    expect(bv.status).toBe("rejected");
    expect(bv.requested_amount).toBe(1_480_000); // README scenario 3: ₹14,80,000 vs ₹12,00,000 available
    const a = assessApproval(bv, null);
    expect(a).toMatchObject({ approval_required: false, recommendation: "reject", triggered_rules: ["budget_rejected"] });
    expect(decideOutcome({ parsed_request: req, approval_assessment: a })).toBe("rejected");
  });

  it("skips budget validation when no vendor was eligible", () => {
    const req = parseRequest("Purchase 5 laptops for the marketing department with a maximum budget of ₹1,00,000.");
    const bv = validateBudget(req, { candidates: [], recommended_vendor_id: null, explanation: "" }, 400000);
    expect(bv).toMatchObject({ status: "skipped", requested_amount: null });
    expect(assessApproval(bv, null).triggered_rules).toEqual(["no_eligible_vendor"]);
  });
});

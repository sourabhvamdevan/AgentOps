/**
 * Pure, deterministic procurement logic for the synthetic engine.
 *
 * Every function here is a line-for-line port of the backend's demo-mode behaviour
 * (tools/request_parser.py, tools/vendor_tools.py, tools/policy_tools.py, agents/*.py,
 * orchestration/routing.py, tools/report_tools.py). No timers, no randomness, no I/O.
 */
import type {
  ApprovalAssessment,
  ApprovalSummary,
  BudgetValidation,
  ErrorRecord,
  Outcome,
  ParsedRequest,
  ProcurementReport,
  VendorEvaluation,
  VendorQuote,
} from "../types";
import { BUDGETS, type CatalogVendor, departments, POLICY, products, VENDORS } from "./catalog";

export const RULE_AMOUNT_ABOVE_THRESHOLD = "amount_above_human_approval_threshold";
export const RULE_LOW_REMAINING_BUDGET = "low_remaining_budget";

/** Indian digit grouping, same output as the backend's _inr(): 685000 -> ₹6,85,000 */
export function inr(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  const sign = n < 0 ? "-" : "";
  if (s.length <= 3) return `${sign}₹${s}`;
  let head = s.slice(0, -3);
  const tail = s.slice(-3);
  const groups: string[] = [];
  while (head.length > 2) {
    groups.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head) groups.unshift(head);
  return `${sign}₹${[...groups, tail].join(",")}`;
}

// ---- request parsing ------------------------------------------------------------------------

const UNIT_MULTIPLIERS: Record<string, number> = {
  lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000, l: 100_000,
  crore: 10_000_000, crores: 10_000_000, cr: 10_000_000,
  k: 1_000, thousand: 1_000,
}; // prettier-ignore

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const UNIT = String.raw`(lakhs?|lacs?|crores?|cr|l|k|thousand)\b`;
const CURRENCY_RE = new RegExp(String.raw`(?:₹|\brs\.?|\binr)\s*(${NUM})(?:\s*${UNIT})?`, "i");
const UNIT_RE = new RegExp(String.raw`\b(${NUM})\s*${UNIT}`, "i");
const BUDGET_KEYWORD_RE = new RegExp(String.raw`\bbudget\s+(?:of\s+|is\s+|:\s*)?(${NUM})\b`, "i");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const productPattern = (p: string) => `${escapeRe(p)}(?:s|es)?`;
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function toAmount(num: string, unit?: string): number | null {
  const value = parseFloat(num.replace(/,/g, ""));
  if (Number.isNaN(value)) return null;
  return Math.round(unit ? value * UNIT_MULTIPLIERS[unit.toLowerCase()] : value);
}

/** Parses INR amounts like ₹8,00,000 / Rs 800000 / INR 8 lakh / 8L / 1.2 crore. */
export function parseBudget(text: string): number | null {
  for (const re of [CURRENCY_RE, UNIT_RE]) {
    const m = re.exec(text);
    if (m) return toAmount(m[1], m[2]);
  }
  const m = BUDGET_KEYWORD_RE.exec(text);
  return m ? toAmount(m[1]) : null;
}

export function parseProductAndQuantity(text: string, prods: string[]): [string | null, number | null] {
  let best: { pos: number; product: string; qty: number | null } | null = null;
  for (const product of prods) {
    const noun = new RegExp(String.raw`\b${productPattern(product)}\b`, "i").exec(text);
    if (!noun) continue;
    const q = new RegExp(String.raw`(?<![\d,.₹])\b(\d+)\s+(?:[a-z-]+\s+){0,2}?${productPattern(product)}\b`, "i").exec(text);
    const qty = q ? parseInt(q[1], 10) : null;
    if (best === null || noun.index < best.pos) best = { pos: noun.index, product, qty };
  }
  return best ? [best.product, best.qty] : [null, null];
}

export function parseDepartment(text: string, depts: string[]): string | null {
  const m = /for\s+(?:the\s+)?([a-z][a-z &-]*?)\s+(?:department|dept|team)\b/i.exec(text);
  if (m) {
    const name = m[1].trim().toLowerCase();
    const known = depts.find((d) => d.toLowerCase() === name);
    if (known) return known;
  }
  for (const d of depts) if (new RegExp(String.raw`\b${escapeRe(d)}\b`, "i").test(text)) return d;
  return m ? titleCase(m[1].trim()) : null; // named, but unknown; validation rejects it
}

export function validateFields(
  fields: { department: string | null; product: string | null; quantity: number | null; maximum_budget: number | null },
  depts: string[],
  prods: string[],
): ParsedRequest {
  const { department, product, quantity, maximum_budget: budget } = fields;
  const keys = ["department", "product", "quantity", "maximum_budget"] as const;
  const missing = keys.filter((k) => fields[k] === null || fields[k] === "");
  const problems: string[] = [];
  if (quantity !== null && !(POLICY.QUANTITY_MIN <= quantity && quantity <= POLICY.QUANTITY_MAX))
    problems.push(`quantity must be between ${POLICY.QUANTITY_MIN} and ${POLICY.QUANTITY_MAX}`);
  if (budget !== null && budget <= 0) problems.push("maximum_budget must be greater than 0");
  if (department && !depts.includes(department)) problems.push(`unknown department '${department}' (known: ${depts.join(", ")})`);
  if (product && !prods.includes(product)) problems.push(`unknown product '${product}' (catalog: ${prods.join(", ")})`);
  if (missing.length) problems.unshift("missing: " + missing.join(", "));
  return {
    department,
    product,
    quantity,
    maximum_budget: budget,
    status: problems.length ? "invalid" : "valid",
    missing_fields: [...missing],
    reason: problems.length ? problems.join("; ") : null,
  };
}

export function parseRequest(text: string, depts = departments(), prods = products()): ParsedRequest {
  const [product, quantity] = parseProductAndQuantity(text, prods);
  return validateFields(
    { department: parseDepartment(text, depts), product, quantity, maximum_budget: parseBudget(text) },
    depts,
    prods,
  );
}

// ---- vendors ---------------------------------------------------------------------------------

export function getVendors(product: string): CatalogVendor[] {
  return VENDORS.filter((v) => v.product === product).sort((a, b) => a.id.localeCompare(b.id));
}

const normalize = (value: number, lo: number, hi: number, degenerate: number) => (hi === lo ? degenerate : (value - lo) / (hi - lo));
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** score = 0.6*(1-price) + 0.25*(1-delivery) + 0.15*rating, min-max normalised across eligible vendors. */
export function scoreVendors(vendors: CatalogVendor[], quantity: number, maximumBudget: number): { quotes: VendorQuote[]; recommended: string | null } {
  const quotes: VendorQuote[] = vendors.map((v) => ({
    vendor_id: v.id,
    name: v.name,
    unit_price: v.unit_price,
    total_price: v.unit_price * quantity,
    delivery_days: v.delivery_days,
    rating: v.rating,
    score: null,
    within_budget: v.unit_price * quantity <= maximumBudget,
  }));
  const eligible = quotes.filter((q) => q.within_budget);
  if (!eligible.length) return { quotes, recommended: null };

  const prices = eligible.map((q) => q.total_price);
  const days = eligible.map((q) => q.delivery_days);
  const ratings = eligible.map((q) => q.rating);
  for (const q of eligible) {
    const p = normalize(q.total_price, Math.min(...prices), Math.max(...prices), 0);
    const d = normalize(q.delivery_days, Math.min(...days), Math.max(...days), 0);
    const r = normalize(q.rating, Math.min(...ratings), Math.max(...ratings), 1);
    q.score = round4(POLICY.WEIGHT_PRICE * (1 - p) + POLICY.WEIGHT_DELIVERY * (1 - d) + POLICY.WEIGHT_RATING * r);
  }
  const best = [...eligible].sort((a, b) => (b.score! - a.score!) || a.total_price - b.total_price || a.vendor_id.localeCompare(b.vendor_id))[0];
  quotes.sort((a, b) => Number(!a.within_budget) - Number(!b.within_budget) || (b.score ?? 0) - (a.score ?? 0) || a.total_price - b.total_price);
  return { quotes, recommended: best.vendor_id };
}

export function explainVendor(req: ParsedRequest, quotes: VendorQuote[], recommended: string | null): string {
  if (recommended === null) {
    const cheapest = quotes.length ? quotes.reduce((a, b) => (b.total_price < a.total_price ? b : a)) : null;
    return (
      `No vendor can supply ${req.quantity} ${req.product}(s) within the maximum budget of ${inr(req.maximum_budget!)}.` +
      (cheapest ? ` The cheapest quote is ${cheapest.name} at ${inr(cheapest.total_price)}.` : "")
    );
  }
  const best = quotes.find((q) => q.vendor_id === recommended)!;
  const eligible = quotes.filter((q) => q.within_budget).length;
  return (
    `${best.name} is recommended with the highest weighted score (${best.score!.toFixed(2)}) among ${eligible} ` +
    `vendor(s) within budget: ${inr(best.total_price)} total (${inr(best.unit_price)} per unit), ` +
    `${best.delivery_days}-day delivery, rating ${best.rating}.`
  );
}

// ---- budget ----------------------------------------------------------------------------------

export function getDepartmentBudget(department: string): { department: string; available_budget: number } | null {
  const row = BUDGETS.find((b) => b.department.toLowerCase() === department.toLowerCase());
  return row ? { department: row.department, available_budget: row.available_budget } : null;
}

export function calculateBudgetCheck(requested: number, available: number) {
  return { requested, available, remaining: available - requested, within_budget: requested <= available };
}

export function validateBudget(req: ParsedRequest, ev: VendorEvaluation, available: number): BudgetValidation {
  if (ev.recommended_vendor_id === null) {
    return {
      requested_amount: null,
      available_budget: available,
      remaining_budget: null,
      status: "skipped",
      reason: "No vendor was eligible within the maximum budget, so there is no amount to validate.",
    };
  }
  const quote = ev.candidates.find((q) => q.vendor_id === ev.recommended_vendor_id)!;
  const check = calculateBudgetCheck(quote.total_price, available);
  const withinMax = quote.total_price <= req.maximum_budget!;
  let status: BudgetValidation["status"];
  let reason: string;
  if (check.within_budget && withinMax) {
    status = "approved";
    reason = `${inr(check.requested)} is within the ${req.department} budget of ${inr(check.available)}; ${inr(check.remaining)} would remain.`;
  } else if (!check.within_budget) {
    status = "rejected";
    reason = `${inr(check.requested)} exceeds the ${req.department} available budget of ${inr(check.available)}.`;
  } else {
    status = "rejected";
    reason = `${inr(check.requested)} exceeds the request's maximum budget of ${inr(req.maximum_budget!)}.`;
  }
  return { requested_amount: check.requested, available_budget: check.available, remaining_budget: check.remaining, status, reason };
}

// ---- approval policy -------------------------------------------------------------------------

export function evaluatePolicy(requested: number, available: number, remaining: number) {
  const rules: string[] = [];
  if (requested > POLICY.HUMAN_APPROVAL_THRESHOLD_INR) rules.push(RULE_AMOUNT_ABOVE_THRESHOLD);
  if (available > 0 && remaining < POLICY.LOW_REMAINING_BUDGET_RATIO * available) rules.push(RULE_LOW_REMAINING_BUDGET);
  return { approval_required: rules.length > 0, triggered_rules: rules };
}

export function assessApproval(budget: BudgetValidation, policy: ReturnType<typeof evaluatePolicy> | null): ApprovalAssessment {
  if (budget.status !== "approved" || policy === null) {
    return {
      approval_required: false,
      recommendation: "reject",
      triggered_rules: [budget.status === "rejected" ? "budget_rejected" : "no_eligible_vendor"],
      summary: `Automatically rejected: ${budget.reason}`,
    };
  }
  return {
    approval_required: policy.approval_required,
    recommendation: "approve",
    triggered_rules: policy.triggered_rules,
    summary: policy.approval_required
      ? `Recommend approval of ${inr(budget.requested_amount!)}; human review required by policy (${policy.triggered_rules.join(", ")}).`
      : `${inr(budget.requested_amount!)} is within all policy thresholds; auto-approval recommended.`,
  };
}

// ---- routing & outcome -----------------------------------------------------------------------

export type State = {
  parsed_request?: ParsedRequest | null;
  vendor_evaluation?: VendorEvaluation | null;
  budget_validation?: BudgetValidation | null;
  approval_assessment?: ApprovalAssessment | null;
  human_decision?: { decision: "approve" | "reject"; decided_at: string; decided_by: string; comment: string | null } | null;
};

export const routeAfterRequest = (s: State) => (s.parsed_request?.status === "valid" ? "vendor_agent" : "finalize");
export const explainAfterRequest = (s: State) =>
  routeAfterRequest(s) === "vendor_agent"
    ? "Request is valid; continuing to vendor comparison."
    : `Request is invalid (${s.parsed_request?.reason || "unparseable"}); skipping to finalize with failed_validation.`;
export const routeAfterApproval = (s: State) => (s.approval_assessment?.approval_required ? "human_review" : "finalize");
export const explainAfterApproval = (s: State) =>
  routeAfterApproval(s) === "human_review"
    ? `Policy requires human approval (${(s.approval_assessment?.triggered_rules ?? []).join(", ")}).`
    : `No human approval required; recommendation is '${s.approval_assessment?.recommendation}'.`;

export function decideOutcome(s: State): Exclude<Outcome, "error"> {
  if (s.parsed_request?.status !== "valid") return "failed_validation";
  if (s.human_decision) return s.human_decision.decision === "approve" ? "approved" : "rejected";
  return s.approval_assessment?.recommendation === "approve" ? "approved" : "rejected";
}

export function approvalSummary(s: State): ApprovalSummary {
  const p = s.parsed_request!;
  const v = s.vendor_evaluation!;
  const b = s.budget_validation!;
  const a = s.approval_assessment!;
  const q = v.candidates.find((c) => c.vendor_id === v.recommended_vendor_id)!;
  return {
    department: p.department!,
    product: p.product!,
    quantity: p.quantity!,
    maximum_budget: p.maximum_budget!,
    vendor: { vendor_id: q.vendor_id, name: q.name, unit_price: q.unit_price, total_price: q.total_price, delivery_days: q.delivery_days, rating: q.rating },
    vendor_explanation: v.explanation,
    requested_amount: b.requested_amount!,
    available_budget: b.available_budget!,
    remaining_budget: b.remaining_budget!,
    recommendation: a.recommendation,
    triggered_rules: a.triggered_rules,
    assessment_summary: a.summary,
  };
}

// ---- report ----------------------------------------------------------------------------------

function reportReason(outcome: Outcome, s: State, errorMessage: string | null): string | null {
  const { parsed_request: parsed, budget_validation: budget, approval_assessment: approval, human_decision: human } = s;
  if (outcome === "error") return errorMessage || "The workflow failed with an internal error.";
  if (outcome === "failed_validation") return `Request could not be validated: ${parsed ? parsed.reason : "not parsed"}`;
  if (outcome === "rejected") {
    if (human && human.decision === "reject") return "Rejected by human reviewer." + (human.comment ? ` Comment: ${human.comment}` : "");
    if (budget && budget.status !== "approved") return `Auto-rejected: ${budget.reason}`;
    if (approval) return `Auto-rejected: ${approval.summary}`;
  }
  if (outcome === "approved") return human ? "Approved by human reviewer." : "Auto-approved: within policy thresholds.";
  return null;
}

export function buildReport(args: {
  executionId: string;
  state: State;
  outcome: Outcome;
  startedAt: string | null;
  completedAt: string | null;
  agentsRun: number;
  errorMessage?: string | null;
}): ProcurementReport {
  const { state: s, outcome } = args;
  const { parsed_request: parsed, vendor_evaluation: vendor, budget_validation: budget, approval_assessment: approval, human_decision: human } = s;
  let recommended: ProcurementReport["recommended_vendor"] = null;
  if (vendor?.recommended_vendor_id) {
    const q = vendor.candidates.find((c) => c.vendor_id === vendor.recommended_vendor_id)!;
    recommended = { vendor_id: q.vendor_id, name: q.name, unit_price: q.unit_price, total_price: q.total_price, delivery_days: q.delivery_days };
  }
  let approvalSection: ProcurementReport["approval"] = null;
  if (approval) {
    let decision: string | null = null;
    if (human) decision = human.decision === "approve" ? "approved" : "rejected";
    else if (outcome === "approved" || outcome === "rejected") decision = outcome;
    approvalSection = {
      required: approval.approval_required,
      recommendation: approval.recommendation,
      decision,
      decided_by: decision ? (human ? human.decided_by : "policy (automatic)") : null,
      comment: human?.comment ?? null,
      triggered_rules: approval.triggered_rules,
    };
  }
  return {
    execution_id: args.executionId,
    outcome,
    execution_mode: "demo",
    reason: reportReason(outcome, s, args.errorMessage ?? null),
    request_summary: parsed
      ? { department: parsed.department, product: parsed.product ? titleCase(parsed.product) : null, quantity: parsed.quantity, maximum_budget: parsed.maximum_budget }
      : null,
    recommended_vendor: recommended,
    vendor_comparison: vendor ? vendor.candidates : null,
    budget: budget ? { requested_amount: budget.requested_amount, available_budget: budget.available_budget, remaining_budget: budget.remaining_budget, status: budget.status } : null,
    approval: approvalSection,
    timeline_summary: { started_at: args.startedAt, completed_at: args.completedAt, agents_run: args.agentsRun },
    data_source: "synthetic",
    disclaimer: "All data is fictional. No real purchase was made.",
  };
}

export const FAILURE_TRIGGER = /simulate[\s-]*failure/i;

export const SIMULATED_FAILURE: ErrorRecord = {
  class: "ToolTimeoutError",
  message: "get_vendors did not respond within 30s (injected by the synthetic fault simulator)",
  agent_id: "vendor_agent",
  retryable: true,
  details: { injected: true },
};

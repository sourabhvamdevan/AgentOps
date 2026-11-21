/** Historical synthetic runs generated on first load so dashboards are never empty. */
export interface SeedRun {
  hoursAgo: number;
  text: string;
  decision?: { verdict: "approve" | "reject"; afterMinutes: number; comment: string | null };
}

export const SEED_RUNS: SeedRun[] = [
  { hoursAgo: 22.5, text: "Purchase 10 laptops for the engineering department with a maximum budget of ₹8,00,000.", decision: { verdict: "approve", afterMinutes: 14, comment: "Within the Q3 hardware plan." } },
  { hoursAgo: 21.4, text: "Buy 2 monitors for the Finance department with a maximum budget of ₹50,000." },
  { hoursAgo: 20.2, text: "Purchase 20 laptops for the engineering department with a maximum budget of ₹20,00,000." },
  { hoursAgo: 19.1, text: "Purchase 5 laptops for the marketing department with a maximum budget of ₹1,00,000." },
  { hoursAgo: 18.3, text: "buy some stuff" },
  { hoursAgo: 16.6, text: "Order 25 keyboards for the HR department with a maximum budget of ₹1,00,000." },
  { hoursAgo: 14.8, text: "Purchase 8 laptops for the marketing department with a maximum budget of ₹6,00,000." },
  { hoursAgo: 12.7, text: "Buy 6 laptops for the engineering department with a maximum budget of 5 lakh." },
  { hoursAgo: 11.2, text: "Purchase 14 monitors for the finance department with a maximum budget of ₹2,00,000." },
  { hoursAgo: 9.4, text: "Purchase 4 laptops for the HR department with a maximum budget of ₹4,00,000. simulate failure" },
  { hoursAgo: 8.1, text: "Purchase 12 laptops for the engineering department with a maximum budget of ₹10,00,000.", decision: { verdict: "reject", afterMinutes: 22, comment: "Defer to next quarter." } },
  { hoursAgo: 6.3, text: "Buy 40 keyboards for the finance department with a maximum budget of ₹1,00,000." },
  { hoursAgo: 5.0, text: "Purchase 18 monitors for the engineering department with a maximum budget of ₹3,00,000." },
  { hoursAgo: 3.2, text: "Purchase 11 laptops for the engineering department with a maximum budget of ₹9,00,000.", decision: { verdict: "approve", afterMinutes: 9, comment: "Approved: urgent hiring batch." } },
  { hoursAgo: 1.6, text: "Purchase 9 laptops for the engineering department with a maximum budget of ₹7,50,000." },
  { hoursAgo: 0.5, text: "Order 3 chairs for the HR department with a maximum budget of ₹50,000." },
];

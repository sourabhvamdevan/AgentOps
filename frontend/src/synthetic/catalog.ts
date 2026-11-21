/** Synthetic reference data. Mirrors backend/app/database/seed.py and backend/app/config/policy.py. */

export interface CatalogVendor {
  id: string;
  name: string;
  product: string;
  unit_price: number;
  delivery_days: number;
  rating: number;
}

export const VENDORS: CatalogVendor[] = [
  { id: "v1", name: "NorthPeak Systems", product: "laptop", unit_price: 74000, delivery_days: 7, rating: 4.2 },
  { id: "v2", name: "Zenvolt Technologies", product: "laptop", unit_price: 68500, delivery_days: 12, rating: 3.9 },
  { id: "v3", name: "Corebridge Supplies", product: "laptop", unit_price: 82000, delivery_days: 4, rating: 4.7 },
  { id: "v4", name: "Lumina Hardware", product: "laptop", unit_price: 91000, delivery_days: 3, rating: 4.5 },
  { id: "v5", name: "Pixelgrid Distribution", product: "monitor", unit_price: 14500, delivery_days: 5, rating: 4.1 },
  { id: "v6", name: "Zenvolt Technologies", product: "monitor", unit_price: 13200, delivery_days: 9, rating: 3.8 },
  { id: "v7", name: "Corebridge Supplies", product: "keyboard", unit_price: 2400, delivery_days: 3, rating: 4.4 },
  { id: "v8", name: "NorthPeak Systems", product: "keyboard", unit_price: 2100, delivery_days: 6, rating: 4.0 },
];

export const BUDGETS: { id: string; department: string; available_budget: number }[] = [
  { id: "b-engineering", department: "Engineering", available_budget: 1_200_000 },
  { id: "b-marketing", department: "Marketing", available_budget: 400_000 },
  { id: "b-finance", department: "Finance", available_budget: 600_000 },
  { id: "b-hr", department: "HR", available_budget: 250_000 },
];

export const POLICY = {
  HUMAN_APPROVAL_THRESHOLD_INR: 500_000,
  LOW_REMAINING_BUDGET_RATIO: 0.1,
  WEIGHT_PRICE: 0.6,
  WEIGHT_DELIVERY: 0.25,
  WEIGHT_RATING: 0.15,
  QUANTITY_MIN: 1,
  QUANTITY_MAX: 1000,
} as const;

export const departments = (): string[] => BUDGETS.map((b) => b.department).sort();
export const products = (): string[] => [...new Set(VENDORS.map((v) => v.product))].sort();

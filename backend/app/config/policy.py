"""Approval policy constants. Deterministic; never computed by an LLM."""

HUMAN_APPROVAL_THRESHOLD_INR = 500_000
LOW_REMAINING_BUDGET_RATIO = 0.10

# Vendor scoring weights (Section 4.2)
WEIGHT_PRICE = 0.6
WEIGHT_DELIVERY = 0.25
WEIGHT_RATING = 0.15

QUANTITY_MIN = 1
QUANTITY_MAX = 1000

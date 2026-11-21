"""Deterministic demo-mode request parser (Section 6.1) and shared field validation."""
import re
from typing import Any

from app.config.policy import QUANTITY_MAX, QUANTITY_MIN
from app.schemas.domain import ParsedRequest

_UNIT_MULTIPLIERS = {
    "lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000, "l": 100_000,
    "crore": 10_000_000, "crores": 10_000_000, "cr": 10_000_000,
    "k": 1_000, "thousand": 1_000,
}  # fmt: skip

_NUM = r"\d[\d,]*(?:\.\d+)?"
_UNIT = r"(lakhs?|lacs?|crores?|cr|l|k|thousand)\b"
_CURRENCY_RE = re.compile(rf"(?:₹|\brs\.?|\binr)\s*({_NUM})(?:\s*{_UNIT})?", re.IGNORECASE)
_UNIT_RE = re.compile(rf"\b({_NUM})\s*{_UNIT}", re.IGNORECASE)
_BUDGET_KEYWORD_RE = re.compile(rf"\bbudget\s+(?:of\s+|is\s+|:\s*)?({_NUM})\b", re.IGNORECASE)


def _to_amount(number: str, unit: str | None) -> int | None:
    try:
        value = float(number.replace(",", ""))
    except ValueError:
        return None
    if unit:
        value *= _UNIT_MULTIPLIERS[unit.lower()]
    return int(round(value))


def parse_budget(text: str) -> int | None:
    """Parse INR amounts like ₹8,00,000 / Rs 800000 / INR 8 lakh / 8L / 1.2 crore."""
    for regex in (_CURRENCY_RE, _UNIT_RE):
        m = regex.search(text)
        if m:
            return _to_amount(m.group(1), m.group(2))
    m = _BUDGET_KEYWORD_RE.search(text)
    if m:
        return _to_amount(m.group(1), None)
    return None


def _product_pattern(product: str) -> str:
    return rf"{re.escape(product)}(?:s|es)?"


def parse_product_and_quantity(text: str, products: list[str]) -> tuple[str | None, int | None]:
    best: tuple[int, str, int | None] | None = None
    for product in products:
        noun = re.search(rf"\b{_product_pattern(product)}\b", text, re.IGNORECASE)
        if not noun:
            continue
        qty_match = re.search(
            rf"(?<![\d,.₹])\b(\d+)\s+(?:[a-z-]+\s+){{0,2}}?{_product_pattern(product)}\b", text, re.IGNORECASE
        )
        qty = int(qty_match.group(1)) if qty_match else None
        pos = noun.start()
        if best is None or pos < best[0]:
            best = (pos, product, qty)
    if best is None:
        return None, None
    return best[1], best[2]


def parse_department(text: str, departments: list[str]) -> str | None:
    m = re.search(r"for\s+(?:the\s+)?([a-z][a-z &-]*?)\s+(?:department|dept|team)\b", text, re.IGNORECASE)
    if m:
        name = m.group(1).strip().lower()
        for d in departments:
            if d.lower() == name:
                return d
    for d in departments:
        if re.search(rf"\b{re.escape(d)}\b", text, re.IGNORECASE):
            return d
    if m:
        return m.group(1).strip().title()  # named, but unknown; validation will reject it
    return None


def normalize_department(value: str | None, departments: list[str]) -> str | None:
    if not value:
        return None
    v = value.strip().lower().removesuffix(" department").strip()
    for d in departments:
        if d.lower() == v:
            return d
    return value.strip()


def normalize_product(value: str | None, products: list[str]) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    for p in products:
        if re.fullmatch(_product_pattern(p), v):
            return p
    return v


def validate_fields(fields: dict[str, Any], departments: list[str], products: list[str]) -> ParsedRequest:
    """Apply Section 4.1 validation to extracted fields, regardless of how they were extracted."""
    department, product = fields.get("department"), fields.get("product")
    quantity, budget = fields.get("quantity"), fields.get("maximum_budget")
    missing = [k for k in ("department", "product", "quantity", "maximum_budget") if fields.get(k) in (None, "")]
    problems: list[str] = []
    if quantity is not None and not (QUANTITY_MIN <= quantity <= QUANTITY_MAX):
        problems.append(f"quantity must be between {QUANTITY_MIN} and {QUANTITY_MAX}")
    if budget is not None and budget <= 0:
        problems.append("maximum_budget must be greater than 0")
    if department and department not in departments:
        problems.append(f"unknown department '{department}' (known: {', '.join(departments)})")
    if product and product not in products:
        problems.append(f"unknown product '{product}' (catalog: {', '.join(products)})")
    if missing:
        problems.insert(0, "missing: " + ", ".join(missing))
    return ParsedRequest(
        department=department,
        product=product,
        quantity=quantity,
        maximum_budget=budget,
        status="invalid" if problems else "valid",
        missing_fields=missing,
        reason="; ".join(problems) if problems else None,
    )


def parse_request(text: str, departments: list[str], products: list[str]) -> ParsedRequest:
    product, quantity = parse_product_and_quantity(text, products)
    fields = {
        "department": parse_department(text, departments),
        "product": product,
        "quantity": quantity,
        "maximum_budget": parse_budget(text),
    }
    return validate_fields(fields, departments, products)

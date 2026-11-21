"""Vendor lookup tool and deterministic vendor scoring (Section 4.2)."""
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config.policy import WEIGHT_DELIVERY, WEIGHT_PRICE, WEIGHT_RATING
from app.database import repositories as repo
from app.schemas.domain import Vendor, VendorQuote


class GetVendorsArgs(BaseModel):
    product: str


def get_vendors(session: Session, args: GetVendorsArgs) -> list[Vendor]:
    return [
        Vendor(id=v.id, name=v.name, product=v.product, unit_price=v.unit_price, delivery_days=v.delivery_days, rating=v.rating)
        for v in repo.list_vendors_for_product(session, args.product)
    ]


def _normalize(value: float, lo: float, hi: float, degenerate: float) -> float:
    if hi == lo:
        return degenerate
    return (value - lo) / (hi - lo)


def score_vendors(vendors: list[Vendor], quantity: int, maximum_budget: int) -> tuple[list[VendorQuote], str | None]:
    """Return all quotes (eligible ones scored) and the recommended vendor id.

    score = 0.6*(1 - price_norm) + 0.25*(1 - delivery_norm) + 0.15*rating_norm, min-max normalized across
    the eligible set. When a range is degenerate (one candidate or identical values), cost/delivery
    normalize to 0 and rating to 1. Ties are broken by lower total price, then vendor id.
    """
    quotes = [
        VendorQuote(
            vendor_id=v.id,
            name=v.name,
            unit_price=v.unit_price,
            total_price=v.unit_price * quantity,
            delivery_days=v.delivery_days,
            rating=v.rating,
            within_budget=v.unit_price * quantity <= maximum_budget,
        )
        for v in vendors
    ]
    eligible = [q for q in quotes if q.within_budget]
    if not eligible:
        return quotes, None

    prices = [q.total_price for q in eligible]
    days = [q.delivery_days for q in eligible]
    ratings = [q.rating for q in eligible]
    for q in eligible:
        price_norm = _normalize(q.total_price, min(prices), max(prices), 0.0)
        delivery_norm = _normalize(q.delivery_days, min(days), max(days), 0.0)
        rating_norm = _normalize(q.rating, min(ratings), max(ratings), 1.0)
        q.score = round(
            WEIGHT_PRICE * (1 - price_norm) + WEIGHT_DELIVERY * (1 - delivery_norm) + WEIGHT_RATING * rating_norm, 4
        )
    best = sorted(eligible, key=lambda q: (-q.score, q.total_price, q.vendor_id))[0]
    quotes.sort(key=lambda q: (not q.within_budget, -(q.score or 0), q.total_price))
    return quotes, best.vendor_id

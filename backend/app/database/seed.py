"""Idempotent seed of synthetic vendors and budgets. Run: python -m app.database.seed"""
from sqlalchemy.orm import Session

from app.database.models import Budget, Vendor

VENDORS = [
    ("v1", "NorthPeak Systems", "laptop", 74000, 7, 4.2),
    ("v2", "Zenvolt Technologies", "laptop", 68500, 12, 3.9),
    ("v3", "Corebridge Supplies", "laptop", 82000, 4, 4.7),
    ("v4", "Lumina Hardware", "laptop", 91000, 3, 4.5),
    ("v5", "Pixelgrid Distribution", "monitor", 14500, 5, 4.1),
    ("v6", "Zenvolt Technologies", "monitor", 13200, 9, 3.8),
    ("v7", "Corebridge Supplies", "keyboard", 2400, 3, 4.4),
    ("v8", "NorthPeak Systems", "keyboard", 2100, 6, 4.0),
]

BUDGETS = [
    ("b-engineering", "Engineering", 1_200_000),
    ("b-marketing", "Marketing", 400_000),
    ("b-finance", "Finance", 600_000),
    ("b-hr", "HR", 250_000),
]


def seed(session: Session) -> None:
    for vid, name, product, price, days, rating in VENDORS:
        session.merge(Vendor(id=vid, name=name, product=product, unit_price=price, delivery_days=days, rating=rating))
    for bid, dept, amount in BUDGETS:
        session.merge(Budget(id=bid, department=dept, available_budget=amount))
    session.flush()


def main() -> None:
    from app.config.settings import Settings
    from app.database.database import Database

    db = Database(Settings().database_url)
    db.migrate()
    with db.session() as s:
        seed(s)
    print(f"Seeded {len(VENDORS)} vendors and {len(BUDGETS)} budgets into {db.url}")


if __name__ == "__main__":
    main()

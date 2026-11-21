from sqlalchemy import func, select

from app.database.database import Database
from app.database.models import Budget, Vendor
from app.database.seed import seed


def test_migrate_and_seed_idempotent(tmp_path):
    db = Database(f"sqlite:///{tmp_path}/t.db")
    db.migrate()
    db.migrate()
    for _ in range(3):
        with db.session() as s:
            seed(s)
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(Vendor)) == 8
        assert s.scalar(select(func.count()).select_from(Budget)) == 4
        assert s.get(Budget, "b-engineering").available_budget == 1_200_000
    db.dispose()

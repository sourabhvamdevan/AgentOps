"""Budget tools (Section 4.3). Pure Python arithmetic."""
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import repositories as repo
from app.errors import ValidationFailure


class GetDepartmentBudgetArgs(BaseModel):
    department: str


class DepartmentBudget(BaseModel):
    department: str
    available_budget: int


class BudgetCheckArgs(BaseModel):
    requested: int = Field(ge=0)
    available: int = Field(ge=0)


class BudgetCheckResult(BaseModel):
    requested: int
    available: int
    remaining: int
    within_budget: bool


def get_department_budget(session: Session, args: GetDepartmentBudgetArgs) -> DepartmentBudget:
    row = repo.get_budget(session, args.department)
    if row is None:
        raise ValidationFailure(f"No budget found for department '{args.department}'")
    return DepartmentBudget(department=row.department, available_budget=row.available_budget)


def calculate_budget_check(args: BudgetCheckArgs) -> BudgetCheckResult:
    return BudgetCheckResult(
        requested=args.requested,
        available=args.available,
        remaining=args.available - args.requested,
        within_budget=args.requested <= args.available,
    )

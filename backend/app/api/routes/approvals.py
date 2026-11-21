from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_runtime, get_service
from app.api.serializers import approval_out
from app.database import repositories as repo
from app.orchestration.graph import Runtime
from app.schemas.api import DecisionCreate
from app.services.execution_service import ExecutionService

router = APIRouter(tags=["approvals"])


@router.get("/approvals")
async def list_approvals(
    status: Literal["pending", "approved", "rejected"] | None = Query(default=None), rt: Runtime = Depends(get_runtime)
):
    with rt.db.session() as s:
        return {"items": [approval_out(a) for a in repo.list_approvals(s, status)]}


@router.post("/approvals/{approval_id}/decision")
async def decide(approval_id: str, body: DecisionCreate, svc: ExecutionService = Depends(get_service)):
    approval = await svc.decide(approval_id, body.decision, body.comment)
    return approval_out(approval)

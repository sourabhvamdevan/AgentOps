from fastapi import APIRouter, Depends, Request

from app.api.deps import get_runtime, get_service
from app.api.errors import ApiError
from app.orchestration.graph import Runtime
from app.services.execution_service import ExecutionService

router = APIRouter(tags=["demo"])


@router.post("/demo/reset")
async def reset(request: Request, rt: Runtime = Depends(get_runtime), svc: ExecutionService = Depends(get_service)):
    if not rt.settings.demo_reset_enabled:
        raise ApiError(403, "reset_disabled", "Demo reset is disabled on this deployment")
    await svc.reset()
    return {"status": "reset", "message": "Executions, events, approvals and reports wiped; reference data re-seeded."}

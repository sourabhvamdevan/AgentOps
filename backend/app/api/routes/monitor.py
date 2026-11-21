from fastapi import APIRouter, Depends

from app.api.deps import get_runtime
from app.orchestration.graph import Runtime
from app.services.monitor_service import build_summary

router = APIRouter(tags=["monitor"])


@router.get("/monitor/summary")
async def monitor_summary(rt: Runtime = Depends(get_runtime)):
    """Fleet-level aggregates for the Workflow Monitor page."""
    with rt.db.session() as s:
        return build_summary(s)

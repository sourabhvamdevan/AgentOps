from fastapi import APIRouter, Depends

from app.api.deps import get_runtime
from app.orchestration.graph import Runtime

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(rt: Runtime = Depends(get_runtime)):
    llm_available = await rt.llm.ping() if rt.llm else False
    return {
        "status": "ok",
        "execution_mode": rt.settings.execution_mode,
        "llm_available": llm_available,
        "llm_model": rt.settings.ollama_model if rt.settings.execution_mode == "llm" else None,
        "demo_reset_enabled": rt.settings.demo_reset_enabled,
        "data_source": "synthetic",
    }

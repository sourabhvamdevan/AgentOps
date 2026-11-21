import asyncio

from fastapi import APIRouter, Depends, Header, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.api.deps import get_rate_limiter, get_runtime, get_service
from app.api.errors import ApiError
from app.api.rate_limit import RateLimiter
from app.api.serializers import event_to_dict, execution_detail, execution_summary
from app.database import repositories as repo
from app.orchestration.graph import Runtime
from app.schemas.api import TERMINAL_STATUSES, ExecutionCreate
from app.services.execution_service import ExecutionService

router = APIRouter(tags=["executions"])

TERMINAL_EVENTS = {"workflow_completed", "workflow_failed"}


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/executions", status_code=202)
async def create_execution(
    body: ExecutionCreate,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=200),
    svc: ExecutionService = Depends(get_service),
    limiter: RateLimiter = Depends(get_rate_limiter),
    rt: Runtime = Depends(get_runtime),
):
    if idempotency_key:
        with rt.db.session() as s:
            existing = repo.get_execution_by_idempotency_key(s, idempotency_key)
        if existing:
            return JSONResponse(execution_summary(existing), status_code=200, headers={"Idempotent-Replay": "true"})
    allowed, retry_after = limiter.check(_client_ip(request))
    if not allowed:
        raise ApiError(
            429,
            "rate_limited",
            f"Too many executions; limit is {limiter.limit} per hour",
            {"retry_after_seconds": retry_after},
            headers={"Retry-After": str(retry_after)},
        )
    ex, created = svc.create(body.request, idempotency_key)
    return JSONResponse(execution_summary(ex), status_code=202 if created else 200)


@router.get("/executions")
async def list_executions(
    limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0), rt: Runtime = Depends(get_runtime)
):
    with rt.db.session() as s:
        rows, total = repo.list_executions(s, limit, offset)
        return {"items": [execution_summary(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/executions/{execution_id}")
async def get_execution(execution_id: str, rt: Runtime = Depends(get_runtime)):
    with rt.db.session() as s:
        ex = repo.get_execution(s, execution_id)
        if ex is None:
            raise ApiError(404, "not_found", f"Execution '{execution_id}' not found")
        return execution_detail(s, ex)


@router.get("/executions/{execution_id}/events")
async def get_events(execution_id: str, after_sequence: int = Query(default=0, ge=0), rt: Runtime = Depends(get_runtime)):
    with rt.db.session() as s:
        if repo.get_execution(s, execution_id) is None:
            raise ApiError(404, "not_found", f"Execution '{execution_id}' not found")
        return {"items": [event_to_dict(e) for e in repo.list_events(s, execution_id, after_sequence)]}


@router.websocket("/executions/{execution_id}/stream")
async def stream(websocket: WebSocket, execution_id: str, after_sequence: int = 0):
    rt: Runtime = websocket.app.state.runtime
    await websocket.accept()
    with rt.db.session() as s:
        exists = repo.get_execution(s, execution_id) is not None
    if not exists:
        await websocket.send_json({"type": "error", "error": {"code": "not_found", "message": "Execution not found"}})
        await websocket.close(code=4404)
        return

    bus = rt.publisher.bus
    queue = bus.subscribe(execution_id)  # subscribe before replay so nothing is missed in between
    receiver = asyncio.create_task(_drain(websocket))
    try:
        last = after_sequence
        with rt.db.session() as s:
            replay = [event_to_dict(e) for e in repo.list_events(s, execution_id, after_sequence)]
            status = repo.get_execution(s, execution_id).status
        for ev in replay:
            await websocket.send_json({"type": "event", "event": ev})
            last = ev["sequence"]
        if status in TERMINAL_STATUSES:
            await websocket.send_json({"type": "closed", "status": status})
            return
        while True:
            getter = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({getter, receiver}, return_when=asyncio.FIRST_COMPLETED)
            if receiver in done:
                getter.cancel()
                return  # client went away
            ev = getter.result()
            if ev["sequence"] <= last:
                continue
            await websocket.send_json({"type": "event", "event": ev})
            last = ev["sequence"]
            if ev["event_type"] in TERMINAL_EVENTS:
                await websocket.send_json({"type": "closed", "status": "completed" if ev["event_type"] == "workflow_completed" else "failed"})
                return
    except WebSocketDisconnect:
        return
    finally:
        receiver.cancel()
        bus.unsubscribe(execution_id, queue)
        try:
            await websocket.close()
        except RuntimeError:
            pass


async def _drain(websocket: WebSocket) -> None:
    """Consume (and ignore) client messages; returns when the client disconnects."""
    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                return
    except (WebSocketDisconnect, RuntimeError):
        return

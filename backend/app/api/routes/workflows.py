from fastapi import APIRouter, Request

from app.api.errors import ApiError
from app.orchestration.graph import WORKFLOW_ID, describe_graph

router = APIRouter(tags=["workflows"])


@router.get("/workflows")
async def list_workflows():
    return {
        "items": [
            {
                "id": WORKFLOW_ID,
                "name": "Procurement approval",
                "description": "Parses a purchase request, compares vendors, validates budget, applies approval policy "
                "and pauses for human review when policy requires it.",
                "agent_count": 4,
            }
        ]
    }


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str, request: Request):
    if workflow_id != WORKFLOW_ID:
        raise ApiError(404, "not_found", f"Workflow '{workflow_id}' not found")
    return describe_graph(request.app.state.graph)

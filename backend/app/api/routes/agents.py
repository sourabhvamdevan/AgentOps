from fastapi import APIRouter

from app.agents.registry import AGENTS
from app.api.errors import ApiError

router = APIRouter(tags=["agents"])


@router.get("/agents")
async def list_agents():
    return {
        "items": [
            {"id": a.id, "name": a.name, "description": a.description, "tools": a.tools} for a in AGENTS.values()
        ]
    }


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str):
    agent = AGENTS.get(agent_id)
    if agent is None:
        raise ApiError(404, "not_found", f"Agent '{agent_id}' not found")
    return agent.metadata()

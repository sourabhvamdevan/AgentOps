"""API request/response models (Section 8)."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

EventType = Literal[
    "workflow_initialized",
    "agent_started",
    "tool_invoked",
    "tool_completed",
    "agent_completed",
    "agent_failed",
    "branch_selected",
    "approval_requested",
    "approval_received",
    "workflow_completed",
    "workflow_failed",
]

ExecutionStatus = Literal["created", "running", "waiting_for_approval", "completed", "failed", "cancelled"]
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


class ExecutionCreate(BaseModel):
    request: str

    @field_validator("request")
    @classmethod
    def _check_length(cls, v: str) -> str:
        v = v.strip()
        if not 10 <= len(v) <= 500:
            raise ValueError("request must be between 10 and 500 characters after trimming")
        return v


class DecisionCreate(BaseModel):
    decision: Literal["approve", "reject"]
    comment: str | None = Field(default=None, max_length=500)


class ExecutionSummary(BaseModel):
    id: str
    status: str
    execution_mode: str
    raw_request: str
    current_stage: str | None = None
    outcome: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    completed_at: datetime | None = None


class EventOut(BaseModel):
    id: str
    execution_id: str
    sequence: int
    agent_id: str | None
    event_type: str
    timestamp: datetime
    data: dict[str, Any]


class ApprovalOut(BaseModel):
    id: str
    execution_id: str
    status: str
    summary: dict[str, Any]
    decision_comment: str | None
    requested_at: datetime
    decided_at: datetime | None

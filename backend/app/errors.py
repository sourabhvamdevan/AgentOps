"""Error classes used across agents, tools and the LLM client (Section 9)."""
from typing import Any


class WorkflowError(Exception):
    error_class = "InternalError"
    retryable = False

    def __init__(self, message: str, details: Any = None):
        super().__init__(message)
        self.message = message
        self.details = details


class ValidationFailure(WorkflowError):
    error_class = "ValidationError"


class ToolPermissionError(WorkflowError):
    error_class = "ToolPermissionError"


class LLMTimeoutError(WorkflowError):
    """Timeouts and transport-level failures talking to the model. Retryable."""

    error_class = "LLMTimeoutError"
    retryable = True


class LLMOutputError(WorkflowError):
    error_class = "LLMOutputError"


class InternalError(WorkflowError):
    error_class = "InternalError"


class AgentFailedError(Exception):
    """Raised by the agent executor after an agent has definitively failed."""

    def __init__(self, record: dict):
        super().__init__(record.get("message", "agent failed"))
        self.record = record

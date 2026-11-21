"""Accessors for app-scoped singletons (set up in main.lifespan)."""
from fastapi import Request

from app.api.rate_limit import RateLimiter
from app.orchestration.graph import Runtime
from app.services.execution_service import ExecutionService


def get_runtime(request: Request) -> Runtime:
    return request.app.state.runtime


def get_service(request: Request) -> ExecutionService:
    return request.app.state.service


def get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter

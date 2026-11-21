"""In-process pub/sub keyed by execution_id."""
import asyncio
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, execution_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers[execution_id].add(q)
        return q

    def unsubscribe(self, execution_id: str, q: asyncio.Queue) -> None:
        subs = self._subscribers.get(execution_id)
        if subs is not None:
            subs.discard(q)
            if not subs:
                self._subscribers.pop(execution_id, None)

    def publish(self, execution_id: str, event: dict[str, Any]) -> None:
        for q in list(self._subscribers.get(execution_id, ())):
            q.put_nowait(event)

    def subscriber_count(self, execution_id: str) -> int:
        return len(self._subscribers.get(execution_id, ()))

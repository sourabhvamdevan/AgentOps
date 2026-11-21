"""Persist-then-publish event publisher with a monotonic per-execution sequence."""
import asyncio
from collections import defaultdict
from typing import Any

from app.database import repositories as repo
from app.database.database import Database
from app.database.models import ExecutionEvent, utcnow
from app.events.bus import EventBus


def event_to_dict(ev: ExecutionEvent) -> dict[str, Any]:
    return {
        "id": ev.id,
        "execution_id": ev.execution_id,
        "sequence": ev.sequence,
        "agent_id": ev.agent_id,
        "event_type": ev.event_type,
        "timestamp": ev.timestamp.isoformat().replace("+00:00", "Z") if ev.timestamp.tzinfo else ev.timestamp.isoformat() + "Z",
        "data": ev.data_json or {},
    }


class EventPublisher:
    def __init__(self, db: Database, bus: EventBus):
        self.db = db
        self.bus = bus
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def publish(
        self, execution_id: str, event_type: str, agent_id: str | None = None, data: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        async with self._locks[execution_id]:
            with self.db.session() as s:
                seq = repo.next_event_sequence(s, execution_id)
                ev = repo.add_event(s, execution_id, seq, event_type, agent_id, data or {}, utcnow())
                payload = event_to_dict(ev)
            # committed above; only now is it visible to subscribers
            self.bus.publish(execution_id, payload)
            return payload

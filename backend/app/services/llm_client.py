"""Minimal Ollama client used only in `llm` mode (parsing + explanation prose)."""
import json
from typing import Any

import httpx

from app.errors import LLMOutputError, LLMTimeoutError


class OllamaClient:
    def __init__(self, base_url: str, model: str, timeout_seconds: float):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout_seconds

    async def ping(self, timeout: float = 1.5) -> bool:
        try:
            async with httpx.AsyncClient(timeout=timeout) as c:
                r = await c.get(f"{self.base_url}/api/tags")
                return r.status_code == 200
        except httpx.HTTPError:
            return False

    async def _chat(self, system: str, user: str, fmt: Any = None) -> str:
        body: dict[str, Any] = {
            "model": self.model,
            "stream": False,
            "options": {"temperature": 0},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        if fmt is not None:
            body["format"] = fmt
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as c:
                r = await c.post(f"{self.base_url}/api/chat", json=body)
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(f"LLM call timed out after {self.timeout}s") from exc
        except httpx.TransportError as exc:
            raise LLMTimeoutError(f"Could not reach LLM at {self.base_url}: {exc.__class__.__name__}") from exc
        if r.status_code >= 500:
            raise LLMTimeoutError(f"LLM server error {r.status_code}")
        if r.status_code != 200:
            raise LLMOutputError(f"LLM returned HTTP {r.status_code}: {r.text[:200]}")
        try:
            return r.json()["message"]["content"]
        except (ValueError, KeyError, TypeError) as exc:
            raise LLMOutputError("LLM response did not contain message content") from exc

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
        content = await self._chat(system, user, fmt=schema)
        try:
            data = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMOutputError("LLM output was not valid JSON", content[:500]) from exc
        if not isinstance(data, dict):
            raise LLMOutputError("LLM output was not a JSON object", content[:500])
        return data

    async def chat_text(self, system: str, user: str) -> str:
        text = (await self._chat(system, user)).strip()
        if not text:
            raise LLMOutputError("LLM returned empty text")
        return text

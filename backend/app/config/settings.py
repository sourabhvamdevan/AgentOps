"""Application settings loaded from environment variables (see .env.example)."""
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    execution_mode: Literal["demo", "llm"] = "demo"
    database_url: str = "sqlite:///./data/app.db"
    checkpoint_db_path: str = "./data/checkpoints.db"
    cors_origins: str = "http://localhost:5173"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"
    llm_timeout_seconds: float = 30
    llm_retry_backoff_seconds: float = 0.5
    demo_reset_enabled: bool = True
    rate_limit_executions_per_hour: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

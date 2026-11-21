FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    EXECUTION_MODE=demo \
    DATABASE_URL=sqlite:////app/data/app.db \
    CHECKPOINT_DB_PATH=/app/data/checkpoints.db

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
RUN mkdir -p /app/data && useradd --create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
# Migrations and seeding run on startup (idempotent), so an empty disk is fine.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

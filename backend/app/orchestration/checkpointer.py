"""SQLite-backed LangGraph checkpointer so approval interrupts survive a process restart."""
from pathlib import Path

import aiosqlite
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


async def open_checkpointer(path: str) -> AsyncSqliteSaver:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(path)
    saver = AsyncSqliteSaver(conn)
    await saver.setup()
    return saver


async def close_checkpointer(saver: AsyncSqliteSaver) -> None:
    await saver.conn.close()


async def wipe_checkpoints(saver: AsyncSqliteSaver) -> None:
    async with saver.lock:
        for table in ("checkpoints", "writes"):
            await saver.conn.execute(f"DELETE FROM {table}")
        await saver.conn.commit()

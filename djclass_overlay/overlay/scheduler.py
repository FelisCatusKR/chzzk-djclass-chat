"""In-process daily V-ARCHIVE sync. A single asyncio task in the runasgi process
(spec Decision 5: one process, no worker container). Once a day at SYNC_HOUR_UTC it
runs sync_all_active_links in a non-thread-sensitive pool thread (like the flush
loop) so the blocking ORM + httpx never stall the event loop."""

import asyncio
import contextlib
import logging
from datetime import UTC
from datetime import datetime
from datetime import timedelta

from asgiref.sync import sync_to_async
from django.db import close_old_connections

from djclass_overlay.djclass.sync import sync_all_active_links

logger = logging.getLogger(__name__)

SYNC_HOUR_UTC = 18  # 18:00 UTC = 03:00 KST (master design §4.7)

_scheduler_task: asyncio.Task[None] | None = None


def _seconds_until(hour_utc: int, now: datetime) -> float:
    """Seconds from `now` (tz-aware UTC) to the next `hour_utc`:00:00 UTC.
    Exactly at the hour -> a full day (24h), so we never busy-loop on a 0 delay."""
    target = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _sync_blocking() -> tuple[int, int]:
    close_old_connections()
    try:
        return sync_all_active_links()
    finally:
        close_old_connections()


async def _run_sync() -> None:
    success, failed = await sync_to_async(_sync_blocking, thread_sensitive=False)()
    logger.info("[scheduler] daily sync done: synced=%s failed=%s", success, failed)


async def daily_sync_loop() -> None:
    while True:
        await asyncio.sleep(_seconds_until(SYNC_HOUR_UTC, datetime.now(UTC)))
        try:
            await _run_sync()
        except Exception:
            logger.exception("[scheduler] daily sync failed")


def ensure_scheduler() -> None:
    """Start the single daily-sync loop (idempotent). Called at runasgi startup."""
    global _scheduler_task  # noqa: PLW0603 — single process-wide scheduler handle
    if _scheduler_task is None or _scheduler_task.done():
        _scheduler_task = asyncio.create_task(daily_sync_loop())


async def stop_scheduler() -> None:
    """Cancel the daily-sync loop on shutdown (idempotent)."""
    global _scheduler_task  # noqa: PLW0603 — single process-wide scheduler handle
    task = _scheduler_task
    _scheduler_task = None
    if task is not None and not task.done():
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

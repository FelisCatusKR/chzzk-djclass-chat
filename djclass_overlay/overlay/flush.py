"""~250 ms batch flush: drain each channel buffer, resolve badges (dedup per sender),
build one batch event, fan out to subscriber queues. New behavior per spec Decisions
6 & 7 (the Node app forwarded per-message over WebSocket; here we batch over SSE)."""

import asyncio
import itertools
import json
import logging

from asgiref.sync import sync_to_async
from django.db import close_old_connections

from djclass_overlay.djclass.resolver import resolve_sender_badges
from djclass_overlay.overlay import registry

logger = logging.getLogger(__name__)

FLUSH_INTERVAL = 0.25     # 250 ms (spec Decision 7)
MAX_BATCH = 200           # abnormal-burst cap (spec §6)
KEEPALIVE_TIMEOUT = 15    # SSE idle heartbeat (matches the spike)

_id_counter = itertools.count(1)
_flush_task = None


def build_batch(raw_messages):
    """Sync: resolve each unique sender once, build the SSE batch payload (§4.4.1)."""
    per_batch = {}
    messages = []
    for m in raw_messages[:MAX_BATCH]:
        sender = m["senderChannelId"]
        cache_key = sender or f"nick:{m['nickname']}"
        if cache_key not in per_batch:
            per_batch[cache_key] = resolve_sender_badges(sender, m["nickname"])
        res = per_batch[cache_key]
        messages.append({
            "id": next(_id_counter),
            "text": m["content"],
            "emojis": m["emojis"],
            "status": res["status"],
            "badge": res["badge"],
        })
    return {"messages": messages}


def _build_batch_detached(raw_messages):
    """build_batch for the detached flush loop. Runs in a NON-thread-sensitive pool
    thread: the loop is spawned by an SSE request but outlives it, so it must not
    ride that request's CurrentThreadExecutor (it quits when the view returns →
    "CurrentThreadExecutor already quit"). close_old_connections() drops any stale
    pooled DB connection before use and releases it after, since a background loop
    never gets Django's per-request connection cleanup."""
    close_old_connections()
    try:
        return build_batch(raw_messages)
    finally:
        close_old_connections()


async def flush_once():
    """One flush tick across all channels."""
    for channel_id, conn in list(registry.connections.items()):
        if not conn.buffer:
            continue
        raw = conn.buffer
        conn.buffer = []
        if not conn.subscribers:
            continue                              # drop: nobody listening
        payload = await sync_to_async(_build_batch_detached, thread_sensitive=False)(raw)
        data = f"event: chat\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
        for q in list(conn.subscribers):
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                pass


async def flush_loop():
    while True:
        await asyncio.sleep(FLUSH_INTERVAL)
        try:
            await flush_once()
        except Exception:
            logger.exception("[flush] tick failed")


def ensure_flush_loop():
    """Start the single global flush loop on first use (idempotent)."""
    global _flush_task
    if _flush_task is None or _flush_task.done():
        _flush_task = asyncio.create_task(flush_loop())

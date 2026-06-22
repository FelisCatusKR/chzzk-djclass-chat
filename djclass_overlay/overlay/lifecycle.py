"""Graceful shutdown of the realtime layer.

Invoked by the `runasgi` management command the moment uvicorn starts exiting: end
the open SSE streams promptly (so their connections close and uvicorn doesn't hang
waiting on the infinite generator), then cancel the background work — the batch
flush loop, the Chzzk chat sockets, and the teardown timers — so the event loop has
nothing orphaned left to force-cancel (which is what produced the CancelledError /
"Event loop stopped before Future completed" traceback on Ctrl+C).
"""

import asyncio
import logging

from djclass_overlay.overlay import flush, registry

logger = logging.getLogger(__name__)

# Set when the server is shutting down. The SSE generator checks it and treats a
# `None` queued item as the wake-up sentinel, so it returns instead of looping.
shutting_down = asyncio.Event()


async def shutdown():
    """Close streams and tear down realtime background tasks (idempotent)."""
    shutting_down.set()

    # Wake every SSE subscriber so its generator returns and the response finishes.
    for conn in list(registry.connections.values()):
        for q in list(conn.subscribers):
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass

    # Stop the global batch flush loop.
    await flush.stop_flush_loop()

    # Disconnect chat sockets and cancel pending teardown timers.
    for channel_id in list(registry.connections.keys()):
        conn = registry.connections.get(channel_id)
        if conn is None:
            continue
        if conn.disconnect_task:
            conn.disconnect_task.cancel()
        if conn.sio is not None:
            try:
                await conn.sio.disconnect()
            except Exception:
                logger.exception("[lifecycle] error disconnecting %s", channel_id)

    logger.info("[lifecycle] realtime shutdown complete")

"""SSE stream + widget page. Async views under ASGI (uvicorn). A widget connection
registers an asyncio.Queue subscriber, lazily starts the channel ingestor and the
global flush loop, streams batch events, and on disconnect schedules a 30s teardown
(mirrors Node addWidget/removeWidget)."""

import asyncio

from django.http import StreamingHttpResponse
from django.shortcuts import render

from djclass_overlay.overlay import flush, ingestor, lifecycle, registry


def _ensure_ingestor(channel_id):
    conn = registry.connections.get(channel_id)
    if conn and conn.sio is None:
        asyncio.create_task(ingestor.connect_to_chat(channel_id))


def _ensure_flush():
    flush.ensure_flush_loop()


def subscribe(channel_id):
    """Register a new SSE subscriber queue; cancel any pending teardown."""
    conn = registry.get_or_create(channel_id)
    ingestor.cancel_teardown(conn)
    q = asyncio.Queue(maxsize=1000)
    conn.subscribers.add(q)
    return q


def unsubscribe(channel_id, q):
    conn = registry.connections.get(channel_id)
    if conn is None:
        return
    conn.subscribers.discard(q)
    if not conn.subscribers:
        ingestor.schedule_teardown(channel_id)


async def widget_stream(request, channel_id):
    q = subscribe(channel_id)
    _ensure_ingestor(channel_id)
    _ensure_flush()

    async def gen():
        try:
            yield ": connected\n\n"  # open the stream promptly
            while not lifecycle.shutting_down.is_set():
                try:
                    item = await asyncio.wait_for(
                        q.get(), timeout=flush.KEEPALIVE_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"  # survive proxy idle timeouts
                    continue
                if item is None:  # shutdown wake-up sentinel
                    break
                yield item
        finally:
            unsubscribe(channel_id, q)

    resp = StreamingHttpResponse(gen(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


def widget_page(request, channel_id):
    return render(request, "overlay/widget.html", {"channel_id": channel_id})

"""SSE stream + widget page. Async views under ASGI (uvicorn). A widget connection
registers an asyncio.Queue subscriber, lazily starts the channel ingestor and the
global flush loop, streams batch events, and on disconnect schedules a 30s teardown
(mirrors Node addWidget/removeWidget).

The SSE `chat` events streamed here carry overlay.flush.BatchPayload bodies (each
overlay.flush.BatchMessage embeds djclass.badges.BadgeDict); this module only relays
the pre-serialized `str` chunks the flush loop enqueues, plus keepalive comments."""

import asyncio
from collections.abc import AsyncIterator

from django.http import HttpRequest
from django.http import HttpResponse
from django.http import StreamingHttpResponse
from django.shortcuts import render

from djclass_overlay.overlay import flush
from djclass_overlay.overlay import ingestor
from djclass_overlay.overlay import lifecycle
from djclass_overlay.overlay import registry
from djclass_overlay.overlay.registry import SubscriberQueue

# Holds fire-and-forget connect tasks so they aren't garbage-collected before they
# finish (asyncio keeps only a weak reference); each task removes itself on done.
_background_tasks: set[asyncio.Task[None]] = set()


def _ensure_ingestor(channel_id: str) -> None:
    conn = registry.connections.get(channel_id)
    if conn and conn.sio is None:
        task = asyncio.create_task(ingestor.connect_to_chat(channel_id))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)


def _ensure_flush() -> None:
    flush.ensure_flush_loop()


def subscribe(channel_id: str) -> SubscriberQueue:
    """Register a new SSE subscriber queue; cancel any pending teardown."""
    conn = registry.get_or_create(channel_id)
    ingestor.cancel_teardown(conn)
    q: SubscriberQueue = asyncio.Queue(maxsize=1000)
    conn.subscribers.add(q)
    return q


def unsubscribe(channel_id: str, q: SubscriberQueue) -> None:
    conn = registry.connections.get(channel_id)
    if conn is None:
        return
    conn.subscribers.discard(q)
    if not conn.subscribers:
        ingestor.schedule_teardown(channel_id)


async def widget_stream(request: HttpRequest, channel_id: str) -> StreamingHttpResponse:
    q = subscribe(channel_id)
    _ensure_ingestor(channel_id)
    _ensure_flush()

    async def gen() -> AsyncIterator[str]:
        try:
            yield ": connected\n\n"  # open the stream promptly
            while not lifecycle.shutting_down.is_set():
                try:
                    item = await asyncio.wait_for(
                        q.get(), timeout=flush.KEEPALIVE_TIMEOUT
                    )
                except TimeoutError:
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


def widget_page(request: HttpRequest, channel_id: str) -> HttpResponse:
    return render(request, "overlay/widget.html", {"channel_id": channel_id})

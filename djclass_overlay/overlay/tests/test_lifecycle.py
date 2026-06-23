import asyncio

import pytest
from asgiref.sync import async_to_sync

from djclass_overlay.overlay import lifecycle, registry, sse


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    registry.connections.clear()
    lifecycle.shutting_down.clear()
    # Keep unit tests off the network / background loops.
    monkeypatch.setattr(sse, "_ensure_ingestor", lambda channel_id: None)
    monkeypatch.setattr(sse, "_ensure_flush", lambda: None)
    yield
    registry.connections.clear()
    lifecycle.shutting_down.clear()


def _chunk_text(chunk):
    return chunk.decode() if isinstance(chunk, (bytes, bytearray)) else chunk


def test_shutdown_sets_event_and_wakes_subscribers():
    async def scenario():
        q = sse.subscribe("ch")
        await lifecycle.shutdown()
        assert lifecycle.shutting_down.is_set()
        assert q.get_nowait() is None  # wake-up sentinel queued for the generator

    async_to_sync(scenario)()


def test_stream_generator_exits_promptly_on_shutdown():
    """A stream blocked waiting for messages must end when shutdown() fires —
    this is what lets the connection close so uvicorn shuts down without hanging."""

    async def scenario():
        resp = await sse.widget_stream(None, "ch")
        agen = resp.streaming_content
        assert "connected" in _chunk_text(await agen.__anext__())

        # Generator is now blocked on q.get() (no messages queued).
        nxt = asyncio.ensure_future(agen.__anext__())
        await asyncio.sleep(0.05)
        assert not nxt.done()

        await lifecycle.shutdown()  # sets event + queues the None sentinel
        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(nxt, timeout=2)

        # finally: unsubscribe ran -> last subscriber gone -> teardown armed
        conn = registry.connections.get("ch")
        assert conn is None or not conn.subscribers

    async_to_sync(scenario)()

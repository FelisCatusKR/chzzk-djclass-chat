import asyncio

import pytest
from asgiref.sync import async_to_sync

from djclass_overlay.overlay import registry, sse


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    registry.connections.clear()
    # Don't touch the network or start background loops in unit tests.
    monkeypatch.setattr(sse, "_ensure_ingestor", lambda channel_id: None)
    monkeypatch.setattr(sse, "_ensure_flush", lambda: None)
    yield
    registry.connections.clear()


def test_subscribe_registers_queue_and_cancels_teardown():
    async def scenario():
        q = sse.subscribe("ch")
        conn = registry.connections["ch"]
        assert q in conn.subscribers
        assert conn.disconnect_task is None
    async_to_sync(scenario)()


def test_unsubscribe_schedules_teardown_when_empty():
    async def scenario():
        q = sse.subscribe("ch")
        sse.unsubscribe("ch", q)
        conn = registry.connections["ch"]
        assert q not in conn.subscribers
        assert conn.disconnect_task is not None     # 30s teardown armed
        conn.disconnect_task.cancel()
    async_to_sync(scenario)()


def test_stream_view_sets_sse_headers(client):
    # A GET to the stream returns a streaming response with SSE headers.
    # (Django's sync test client can fetch the response object without draining it.)
    resp = client.get("/widget/chTest/stream")
    assert resp.status_code == 200
    assert resp["Content-Type"] == "text/event-stream"
    assert resp["Cache-Control"] == "no-cache"
    assert resp["X-Accel-Buffering"] == "no"
    # tidy up the connection registered by the view
    registry.connections.clear()


def test_widget_page_renders(client):
    resp = client.get("/widget/chTest/")
    assert resp.status_code == 200
    assert b"widget.js" in resp.content
    assert b"chTest" in resp.content

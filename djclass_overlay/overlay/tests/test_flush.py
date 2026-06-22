import asyncio
import json

import pytest
from asgiref.sync import async_to_sync

from djclass_overlay.djclass import resolver
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.overlay import flush, registry
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.fixture(autouse=True)
def _reset():
    registry.connections.clear()
    resolver.badge_cache.clear()
    yield
    registry.connections.clear()
    resolver.badge_cache.clear()


@pytest.mark.django_db
def test_build_batch_resolves_and_dedups(django_assert_num_queries):
    u = User.objects.create_user(chzzk_id="s1", chzzk_nickname="N")
    VarchiveToken.objects.create(user=u, token_encrypted="x", varchive_nickname="v", is_active=True)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9810)
    raw = [
        {"senderChannelId": "s1", "nickname": "N", "content": "hi", "emojis": {}},
        {"senderChannelId": "s1", "nickname": "N", "content": "again", "emojis": {"a": "u"}},
        {"senderChannelId": "ghost", "nickname": "G", "content": "yo", "emojis": {}},
    ]
    batch = flush.build_batch(raw)
    msgs = batch["messages"]
    assert len(msgs) == 3
    assert msgs[0]["text"] == "hi"
    assert msgs[0]["status"] == "linked"
    assert msgs[0]["badge"]["auto"]["class"] == "SS II"
    assert msgs[1]["emojis"] == {"a": "u"}
    assert msgs[2]["status"] == "unlinked"
    assert msgs[2]["badge"] is None
    # ids are unique within the batch
    assert len({m["id"] for m in msgs}) == 3


@pytest.mark.django_db
def test_build_batch_caps_messages():
    raw = [{"senderChannelId": "x", "nickname": "X", "content": str(i), "emojis": {}}
           for i in range(flush.MAX_BATCH + 50)]
    batch = flush.build_batch(raw)
    assert len(batch["messages"]) == flush.MAX_BATCH


@pytest.mark.django_db(transaction=True)
def test_flush_once_pushes_event_to_subscribers():
    async def scenario():
        conn = registry.get_or_create("ch")
        q = asyncio.Queue()
        conn.subscribers.add(q)
        conn.buffer.append({"senderChannelId": "", "nickname": "Anon", "content": "hello", "emojis": {}})
        await flush.flush_once()
        assert conn.buffer == []                 # buffer drained
        data = q.get_nowait()
        assert data.startswith("event: chat\ndata: ")
        payload = json.loads(data.split("data: ", 1)[1].strip())
        assert payload["messages"][0]["text"] == "hello"
    async_to_sync(scenario)()


@pytest.mark.django_db(transaction=True)
def test_flush_once_clears_buffer_when_no_subscribers():
    async def scenario():
        conn = registry.get_or_create("ch")
        conn.buffer.append({"senderChannelId": "", "nickname": "A", "content": "x", "emojis": {}})
        await flush.flush_once()
        assert conn.buffer == []                 # dropped — nobody listening
    async_to_sync(scenario)()

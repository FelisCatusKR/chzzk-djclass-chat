import asyncio
from datetime import timedelta

import pytest
from asgiref.sync import async_to_sync
from django.utils import timezone

from djclass_overlay.common import crypto
from djclass_overlay.overlay import ingestor, registry
from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User


@pytest.fixture(autouse=True)
def _clear_registry():
    registry.connections.clear()
    yield
    registry.connections.clear()


@pytest.mark.django_db
def test_get_channel_access_token_fresh():
    u = User.objects.create_user(chzzk_id="c1", chzzk_nickname="N")
    Channel.objects.create(
        user=u,
        chzzk_channel_id="c1",
        chzzk_access_token_encrypted=crypto.encrypt("ACCESS"),
        chzzk_refresh_token_encrypted=crypto.encrypt("REFRESH"),
        token_expires_at=timezone.now() + timedelta(hours=1),
    )
    assert ingestor.get_channel_access_token("c1") == "ACCESS"


@pytest.mark.django_db
def test_get_channel_access_token_refreshes_when_expired(monkeypatch):
    u = User.objects.create_user(chzzk_id="c2", chzzk_nickname="N")
    Channel.objects.create(
        user=u,
        chzzk_channel_id="c2",
        chzzk_access_token_encrypted=crypto.encrypt("OLD"),
        chzzk_refresh_token_encrypted=crypto.encrypt("OLDREFRESH"),
        token_expires_at=timezone.now() - timedelta(seconds=1),
    )
    from djclass_overlay.common import chzzk

    monkeypatch.setattr(
        chzzk, "refresh_access_token",
        lambda rt: {"access_token": "NEW", "refresh_token": "NEWREFRESH", "expires_in": 86400},
    )
    assert ingestor.get_channel_access_token("c2") == "NEW"
    ch = Channel.objects.get(chzzk_channel_id="c2")
    assert crypto.decrypt(ch.chzzk_access_token_encrypted) == "NEW"
    assert crypto.decrypt(ch.chzzk_refresh_token_encrypted) == "NEWREFRESH"
    assert ch.token_expires_at > timezone.now()


@pytest.mark.django_db
def test_get_channel_access_token_none_when_no_channel():
    assert ingestor.get_channel_access_token("missing") is None


def test_schedule_teardown_cancelled_on_rejoin():
    async def scenario():
        conn = registry.get_or_create("ch")
        ingestor.schedule_teardown("ch", delay=10)
        assert conn.disconnect_task is not None
        ingestor.cancel_teardown(conn)        # rejoin cancels it
        assert conn.disconnect_task is None
    async_to_sync(scenario)()

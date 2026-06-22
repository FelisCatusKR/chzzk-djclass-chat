"""Chzzk chat ingestor — pure helpers + (later task) the live socket lifecycle.

Faithful port of src/lib/chat-proxy.ts and the validated spike ~/chzzk-spike/.
"""

import asyncio
import json
import logging
from datetime import timedelta

import socketio
from asgiref.sync import sync_to_async
from django.db import close_old_connections
from django.utils import timezone

from djclass_overlay.common import chzzk, crypto
from djclass_overlay.overlay import registry

logger = logging.getLogger(__name__)

RECONNECT_DELAY = 5      # chat-proxy.ts:367
TEARDOWN_DELAY = 30      # chat-proxy.ts:484


def parse(data):
    """SYSTEM/CHAT payloads arrive as a JSON string or an already-decoded dict
    (chat-proxy.ts:275-285). Fall back to {} on anything else."""
    if isinstance(data, str):
        try:
            return json.loads(data)
        except Exception:
            return {}
    return data if isinstance(data, dict) else {}


def extract_chat(parsed, channel_id):
    """Port of chat-proxy.ts:287-321. Reads exactly the fields the Node app reads,
    with the same fallbacks and coercions; drops non-string emoji values."""
    profile = parsed.get("profile") or {}
    raw_emojis = parsed.get("emojis")
    emojis = (
        {k: v for k, v in raw_emojis.items() if isinstance(v, str)}
        if isinstance(raw_emojis, dict)
        else {}
    )
    return {
        "channelId": str(parsed.get("channelId") or channel_id),
        "senderChannelId": str(profile.get("senderChannelId") or parsed.get("senderChannelId") or ""),
        "nickname": str(profile.get("nickname") or parsed.get("nickname") or ""),
        "content": str(parsed.get("content") or ""),
        "messageTime": int(parsed.get("messageTime") or 0),
        "emojis": emojis,
    }


def get_channel_access_token(channel_id):
    """Read the channel's access token, refreshing (and re-persisting) if expired.
    Plain sync (tested directly); connect_to_chat calls it via sync_to_async.
    Port of chat-proxy.ts:145-201."""
    from djclass_overlay.streamers.models import Channel

    channel = Channel.objects.filter(chzzk_channel_id=channel_id).first()
    if channel is None or not channel.chzzk_access_token_encrypted:
        return None

    if channel.token_expires_at and channel.token_expires_at < timezone.now():
        if not channel.chzzk_refresh_token_encrypted:
            logger.warning("[ingestor] no refresh token for %s", channel_id)
            return None
        try:
            refreshed = chzzk.refresh_access_token(crypto.decrypt(channel.chzzk_refresh_token_encrypted))
        except Exception:
            logger.exception("[ingestor] token refresh failed for %s", channel_id)
            return None
        channel.chzzk_access_token_encrypted = crypto.encrypt(refreshed["access_token"])
        channel.chzzk_refresh_token_encrypted = crypto.encrypt(refreshed["refresh_token"])
        channel.token_expires_at = timezone.now() + timedelta(seconds=refreshed["expires_in"])
        channel.save(update_fields=[
            "chzzk_access_token_encrypted",
            "chzzk_refresh_token_encrypted",
            "token_expires_at",
        ])
        return refreshed["access_token"]

    return crypto.decrypt(channel.chzzk_access_token_encrypted)


def _load_access_token_detached(channel_id):
    """get_channel_access_token for the detached ingestor/reconnect task: runs in a
    NON-thread-sensitive pool thread (must not ride the spawning request's
    CurrentThreadExecutor, which quits when that request ends) + connection hygiene.
    See flush._build_batch_detached for the full rationale."""
    close_old_connections()
    try:
        return get_channel_access_token(channel_id)
    finally:
        close_old_connections()


async def connect_to_chat(channel_id):
    """Connect a channel's Chzzk chat socket and wire CHAT → buffer.
    Dedup via the per-channel lock (port of the connectingPromise pattern)."""
    conn = registry.get_or_create(channel_id)
    async with conn.connect_lock:
        if conn.sio is not None and getattr(conn.sio, "connected", False):
            return
        token = await sync_to_async(_load_access_token_detached, thread_sensitive=False)(channel_id)
        if not token:
            logger.warning("[ingestor] no access token for %s; not connecting", channel_id)
            return

        sio = socketio.AsyncClient(reconnection=False)
        conn.sio = sio

        @sio.on("SYSTEM")
        async def on_system(data):
            parsed = parse(data)
            if parsed.get("type") == "connected":
                key = (parsed.get("data") or {}).get("sessionKey")
                if key:
                    conn.session_key = key
                    try:
                        await chzzk.subscribe_chat(token, key)
                    except Exception:
                        logger.exception("[ingestor] subscribe failed for %s", channel_id)

        @sio.on("CHAT")
        async def on_chat(data):
            conn.buffer.append(extract_chat(parse(data), channel_id))

        @sio.on("disconnect")
        async def on_disconnect():
            conn.sio = None
            conn.session_key = None
            if conn.subscribers:
                schedule_reconnect(channel_id)
            else:
                registry.connections.pop(channel_id, None)

        url = await chzzk.get_session_url(token)
        try:
            await sio.connect(url, transports=["websocket"])
        except Exception:
            logger.exception("[ingestor] connect failed for %s", channel_id)
            conn.sio = None


def schedule_reconnect(channel_id, delay=RECONNECT_DELAY):
    """Single fixed-delay reconnect iff subscribers remain (chat-proxy.ts:343-372)."""
    async def _later():
        await asyncio.sleep(delay)
        conn = registry.connections.get(channel_id)
        if conn and conn.subscribers and conn.sio is None:
            await connect_to_chat(channel_id)
    asyncio.create_task(_later())


def schedule_teardown(channel_id, delay=TEARDOWN_DELAY):
    """Arm the 30s teardown after the last subscriber leaves (chat-proxy.ts:472-492)."""
    conn = registry.connections.get(channel_id)
    if conn is None:
        return
    if conn.disconnect_task:
        conn.disconnect_task.cancel()

    async def _later():
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        c = registry.connections.get(channel_id)
        if c and not c.subscribers:
            await teardown(channel_id)

    conn.disconnect_task = asyncio.create_task(_later())


def cancel_teardown(conn):
    """Cancel a pending teardown when a widget rejoins (chat-proxy.ts:460-464)."""
    if conn.disconnect_task:
        conn.disconnect_task.cancel()
        conn.disconnect_task = None


async def teardown(channel_id):
    conn = registry.connections.pop(channel_id, None)
    if conn is None:
        return
    cancel_teardown(conn)
    if conn.sio is not None:
        try:
            await conn.sio.disconnect()
        except Exception:
            pass

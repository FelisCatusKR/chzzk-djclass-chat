"""In-memory realtime registry. Single process / single event loop (spec Decision 5).

Maps channel_id -> ChannelConnection holding the live Chzzk socket, the raw-message
buffer, the set of SSE subscriber queues, and the teardown timer. Mirrors the Node
`connections` Map in src/lib/chat-proxy.ts.
"""

import asyncio
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import TypedDict


class ChatMessage(TypedDict):
    """A normalized CHAT message buffered for the next flush (ingestor.extract_chat).

    Exactly the fields the Node app reads (chat-proxy.ts:287-321); `emojis` maps an
    emoji key to its image URL (non-string values are dropped at extraction)."""

    channelId: str
    senderChannelId: str
    nickname: str
    content: str
    messageTime: int
    emojis: dict[str, str]


# A subscriber queue carries SSE `str` chunks; a queued `None` is the shutdown
# wake-up sentinel the SSE generator checks for (overlay.lifecycle.shutdown).
SubscriberQueue = asyncio.Queue[str | None]


@dataclass
class ChannelConnection:
    channel_id: str
    # socketio.AsyncClient | None; Any because python-socketio ships no stubs, so we
    # still get attribute access (.connected / .disconnect()) without it being object.
    sio: Any = None
    session_key: str | None = None
    buffer: list[ChatMessage] = field(default_factory=list)  # raw CHAT message dicts
    subscribers: set[SubscriberQueue] = field(default_factory=set)  # one per widget
    disconnect_task: asyncio.Task[None] | None = None  # 30s teardown timer
    connect_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


connections: dict[str, ChannelConnection] = {}


def get_or_create(channel_id: str) -> ChannelConnection:
    conn = connections.get(channel_id)
    if conn is None:
        conn = ChannelConnection(channel_id=channel_id)
        connections[channel_id] = conn
    return conn

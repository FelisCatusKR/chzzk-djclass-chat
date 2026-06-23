"""In-memory realtime registry. Single process / single event loop (spec Decision 5).

Maps channel_id -> ChannelConnection holding the live Chzzk socket, the raw-message
buffer, the set of SSE subscriber queues, and the teardown timer. Mirrors the Node
`connections` Map in src/lib/chat-proxy.ts.
"""

from dataclasses import dataclass, field

import asyncio


@dataclass
class ChannelConnection:
    channel_id: str
    sio: object = None  # socketio.AsyncClient | None
    session_key: str | None = None
    buffer: list = field(default_factory=list)  # raw CHAT message dicts
    subscribers: set = field(default_factory=set)  # asyncio.Queue per widget
    disconnect_task: asyncio.Task | None = None  # 30s teardown timer
    connect_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


connections: dict[str, ChannelConnection] = {}


def get_or_create(channel_id):
    conn = connections.get(channel_id)
    if conn is None:
        conn = ChannelConnection(channel_id=channel_id)
        connections[channel_id] = conn
    return conn

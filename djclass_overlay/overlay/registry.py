"""In-memory realtime registry. Single process / single event loop (spec Decision 5).

Maps channel_id -> ChannelConnection holding the live Chzzk socket, the raw-message
buffer, the set of SSE subscriber queues, and the teardown timer. Mirrors the Node
`connections` Map in src/lib/chat-proxy.ts.
"""

import asyncio
from collections.abc import Awaitable
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from typing import Protocol
from typing import TypedDict
from typing import TypeVar


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


_SioHandler = TypeVar("_SioHandler", bound=Callable[..., Awaitable[object]])


class AsyncSocketIO(Protocol):
    """The python-socketio ``AsyncClient`` surface this app actually uses.

    The library ships no type stubs, so rather than fall back to ``Any`` we declare
    just the few members we call. ``on`` is the passthrough decorator form
    (``@sio.on("EVENT")``), generic so each handler keeps its own signature.
    """

    connected: bool

    def on(self, event: str) -> Callable[[_SioHandler], _SioHandler]: ...
    async def connect(
        self, url: str, *, transports: list[str] | None = None
    ) -> None: ...
    async def disconnect(self) -> None: ...


@dataclass
class ChannelConnection:
    channel_id: str
    sio: AsyncSocketIO | None = None  # the live Chzzk socket (None while disconnected)
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

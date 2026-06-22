"""Chzzk chat ingestor — pure helpers + (later task) the live socket lifecycle.

Faithful port of src/lib/chat-proxy.ts and the validated spike ~/chzzk-spike/.
"""

import json


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

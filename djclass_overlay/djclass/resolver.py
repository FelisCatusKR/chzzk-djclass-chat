"""Resolve a chat sender to {status, badge} server-side.

Port of src/app/api/widget/dj-class/route.ts. Synchronous (plain ORM); the async
flush loop calls this via sync_to_async. Results are cached per sender with a TTL
that depends on status (linked 5 min / unsynced 15 s / unlinked 10 s).
"""

from djclass_overlay.common.cache import TTLCache
from djclass_overlay.djclass import badges
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken

badge_cache = TTLCache()

_TTL = {"linked": 300, "unsynced": 15, "unlinked": 10}


def resolve_sender_badges(sender_channel_id, nickname=""):
    key = f"id:{sender_channel_id}" if sender_channel_id else f"nick:{nickname}"
    cached = badge_cache.get(key)
    if cached is not None:
        return cached
    result = _resolve_uncached(sender_channel_id, nickname)
    badge_cache.set(key, result, _TTL[result["status"]])
    return result


def _resolve_uncached(sender_channel_id, nickname):
    user = None
    if sender_channel_id:
        user = User.objects.filter(chzzk_id=sender_channel_id).first()
    if user is None and nickname:
        user = User.objects.filter(chzzk_nickname=nickname).first()
    if user is None:
        return {"status": "unlinked", "badge": None}

    if not VarchiveToken.objects.filter(user=user, is_active=True).exists():
        return {"status": "unlinked", "badge": None}

    rows = list(DjClass.objects.filter(user=user))
    auto = badges.resolve_displayed_class(rows, None, "auto")
    if auto is None:
        return {"status": "unsynced", "badge": None}

    viewer = badges.resolve_displayed_class(rows, user.preferred_button, "viewer")
    return {
        "status": "linked",
        "badge": {"auto": badges.build_badge(auto), "viewer": badges.build_badge(viewer)},
    }

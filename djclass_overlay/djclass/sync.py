"""DJ CLASS persistence + per-user sync (token-less: fetch by stored nickname).

persist_user_dj_classes ports src/lib/dj-class-store.ts. sync_user fetches one
link's classes and persists them, guarding the empty case so a transient V-ARCHIVE
failure or a stale nickname never wipes good data. The management command and the
on-demand /link sync both call sync_user.
"""

from typing import TypedDict
from typing import cast

from django.db import transaction

from djclass_overlay.djclass import badges
from djclass_overlay.djclass import varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.djclass.resolver import invalidate_user
from djclass_overlay.djclass.varchive import VarchiveDjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


class SyncResult(TypedDict):
    ok: bool
    stale: bool
    highest: DjClass | None


@transaction.atomic
def persist_user_dj_classes(user: User, classes: list[VarchiveDjClass]) -> None:
    """Replace `user`'s DjClass rows with `classes`: upsert each button, delete any
    stored button not in the new set. An empty list clears all rows. (synced_at is
    auto_now, so it updates on each save.) Port of persistUserDjClasses."""
    if not classes:
        DjClass.objects.filter(user=user).delete()
        return
    buttons = []
    for c in classes:
        DjClass.objects.update_or_create(
            user=user,
            button=c["button"],
            defaults={
                "dj_class": c["djClass"],
                "dj_power_sum": c["djPowerSum"],
                "max_dj_power": c["maxDjPower"],
                "dj_power_conversion": c["djPowerConversion"],
            },
        )
        buttons.append(c["button"])
    DjClass.objects.filter(user=user).exclude(button__in=buttons).delete()


def sync_user(link: VarchiveToken) -> SyncResult:
    """Fetch + persist DJ CLASS for one active VarchiveToken, by its nickname.

    Returns {"ok": bool, "stale": bool, "highest": DjClass | None}; `stale` is only
    meaningful when `ok` is False. An empty fetch is treated as a probable stale
    nickname / transient error: existing rows are KEPT (not wiped), and stale=True
    when the user already had data.
    """
    classes = varchive.get_all_dj_classes(link.varchive_nickname)
    if not classes:
        had = DjClass.objects.filter(user=link.user).exists()
        invalidate_user(link.user)
        return {"ok": False, "stale": had, "highest": None}
    persist_user_dj_classes(link.user, classes)
    invalidate_user(link.user)
    # Re-fetch as model instances — resolve_displayed_class needs .button/.dj_class/etc.
    rows = list(DjClass.objects.filter(user=link.user))
    # rows is list[DjClass], so the chosen row (if any) is concretely a DjClass;
    # resolve_displayed_class only erases that to the DjClassRow protocol.
    highest = cast("DjClass | None", badges.resolve_displayed_class(rows, None, "auto"))
    return {
        "ok": True,
        "stale": False,
        "highest": highest,
    }

import pytest

from djclass_overlay.djclass import sync
from djclass_overlay.djclass import varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken

CLASSES = [
    {
        "button": 4,
        "djClass": "SHOWSTOPPER II",
        "djPowerSum": 1.0,
        "maxDjPower": 2.0,
        "djPowerConversion": 9823.0,
    },
    {
        "button": 8,
        "djClass": "HEADLINER IV",
        "djPowerSum": 3.0,
        "maxDjPower": 4.0,
        "djPowerConversion": 9410.0,
    },
]


@pytest.mark.django_db
def test_persist_upserts_and_deletes_stale():
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="n")
    DjClass.objects.create(
        user=u, button=6, dj_class="ROOKIE I", dj_power_conversion=4900.0
    )
    sync.persist_user_dj_classes(u, CLASSES)
    rows = {r.button: r for r in DjClass.objects.filter(user=u)}
    assert set(rows) == {4, 8}  # 6 was stale -> deleted
    assert rows[4].dj_class == "SHOWSTOPPER II"
    assert rows[4].dj_power_conversion == 9823.0


@pytest.mark.django_db
def test_persist_empty_clears_all():
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="n")
    DjClass.objects.create(
        user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0
    )
    sync.persist_user_dj_classes(u, [])
    assert DjClass.objects.filter(user=u).count() == 0


@pytest.mark.django_db
def test_sync_user_persists_and_returns_highest(monkeypatch):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="n")
    link = VarchiveToken.objects.create(
        user=u, varchive_nickname="VA", varchive_user_no=1
    )
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: CLASSES)
    result = sync.sync_user(link)
    assert result["ok"] is True
    assert result["highest"].button == 4  # SS II outranks HL IV
    assert DjClass.objects.filter(user=u).count() == 2


@pytest.mark.django_db
def test_sync_user_empty_keeps_existing_rows_and_flags_stale(monkeypatch):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="n")
    link = VarchiveToken.objects.create(
        user=u, varchive_nickname="VA", varchive_user_no=1
    )
    DjClass.objects.create(
        user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0
    )
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: [])
    result = sync.sync_user(link)
    assert result == {"ok": False, "stale": True, "highest": None}
    assert DjClass.objects.filter(user=u).count() == 1  # NOT wiped

from io import StringIO

import pytest
from django.core.management import call_command

from djclass_overlay.djclass import varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.mark.django_db
def test_sync_djclass_command_syncs_active_links(monkeypatch):
    active = User.objects.create_user(chzzk_id="a", chzzk_nickname="A")
    VarchiveToken.objects.create(user=active, varchive_nickname="VA", varchive_user_no=1)
    inactive = User.objects.create_user(chzzk_id="b", chzzk_nickname="B")
    VarchiveToken.objects.create(user=inactive, varchive_nickname="VB",
                                 varchive_user_no=2, is_active=False)

    monkeypatch.setattr(
        varchive, "get_all_dj_classes",
        lambda nick: [{"button": 4, "djClass": "SHOWSTOPPER II", "djPowerSum": 1.0,
                       "maxDjPower": 2.0, "djPowerConversion": 9823.0}],
    )
    out = StringIO()
    call_command("sync_djclass", stdout=out)

    assert DjClass.objects.filter(user=active).count() == 1
    assert DjClass.objects.filter(user=inactive).count() == 0   # inactive skipped
    assert "synced=1 failed=0" in out.getvalue()

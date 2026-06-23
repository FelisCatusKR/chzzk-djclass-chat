import json

import pytest
from django.core.management import call_command

from djclass_overlay.common import crypto
from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_import_legacy(tmp_path):
    data = [
        {
            "chzzk_id": "u1",
            "chzzk_nickname": "Nick",
            "preferred_button": 6,
            "channel": {
                "chzzk_channel_id": "c1",
                "access_token": "ACCESS",
                "refresh_token": "REFRESH",
                "token_expires_at": None,
            },
            "varchive_token": {
                "token": "VTOKEN",
                "varchive_nickname": "vn",
                "is_active": True,
            },
            "dj_classes": [{"button": 4, "dj_class": "SS II"}],
        }
    ]
    p = tmp_path / "legacy.json"
    p.write_text(json.dumps(data))

    call_command("import_legacy", str(p))

    u = User.objects.get(chzzk_id="u1")
    assert u.preferred_button == 6
    assert u.has_usable_password() is False
    ch = Channel.objects.get(user=u)
    assert crypto.decrypt(ch.chzzk_access_token_encrypted) == "ACCESS"
    assert u.djclass_set.count() == 1

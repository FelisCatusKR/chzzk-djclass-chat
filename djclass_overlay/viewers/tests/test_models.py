import pytest

from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.mark.django_db
def test_varchive_token_defaults_active():
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="V")
    t = VarchiveToken.objects.create(
        user=u, token_encrypted="enc", varchive_nickname="vnick"
    )
    assert t.is_active is True

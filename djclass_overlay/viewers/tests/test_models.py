import pytest
from django.core.exceptions import FieldDoesNotExist

from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.mark.django_db
def test_varchive_token_is_tokenless():
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    link = VarchiveToken.objects.create(
        user=u, varchive_nickname="VA-Nick", varchive_user_no=4242
    )
    assert link.is_active is True
    assert link.varchive_user_no == 4242
    # The encrypted token field is gone from the model (token-less design).
    with pytest.raises(FieldDoesNotExist):
        VarchiveToken._meta.get_field("token_encrypted")

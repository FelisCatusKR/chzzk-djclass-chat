import pytest

from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_channel_one_per_user():
    u = User.objects.create_user(chzzk_id="s1", chzzk_nickname="S")
    Channel.objects.create(user=u, chzzk_channel_id="chan1")
    with pytest.raises(Exception):
        Channel.objects.create(user=u, chzzk_channel_id="chan2")

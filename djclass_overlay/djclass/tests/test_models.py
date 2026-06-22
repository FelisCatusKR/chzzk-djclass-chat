import pytest

from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_unique_user_button():
    u = User.objects.create_user(chzzk_id="d1", chzzk_nickname="D")
    DjClass.objects.create(user=u, button=4, dj_class="SS II")
    with pytest.raises(Exception):
        DjClass.objects.create(user=u, button=4, dj_class="HL I")


@pytest.mark.django_db
def test_button_must_be_valid():
    u = User.objects.create_user(chzzk_id="d2", chzzk_nickname="D")
    with pytest.raises(Exception):
        DjClass.objects.create(user=u, button=7, dj_class="SS II")  # 7 not in {4,5,6,8}

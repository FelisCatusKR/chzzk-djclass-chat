import pytest

from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_create_user_is_passwordless():
    u = User.objects.create_user(chzzk_id="abc", chzzk_nickname="Nick")
    assert u.chzzk_id == "abc"
    assert u.has_usable_password() is False
    assert u.is_authenticated is True


@pytest.mark.django_db
def test_chzzk_id_unique():
    User.objects.create_user(chzzk_id="dup", chzzk_nickname="A")
    with pytest.raises(Exception):
        User.objects.create_user(chzzk_id="dup", chzzk_nickname="B")

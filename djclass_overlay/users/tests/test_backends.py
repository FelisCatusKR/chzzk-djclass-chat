import pytest

from djclass_overlay.users.backends import ChzzkBackend
from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_authenticate_returns_user_by_chzzk_id():
    u = User.objects.create_user(chzzk_id="chan1", chzzk_nickname="N")
    assert ChzzkBackend().authenticate(None, chzzk_id="chan1") == u


@pytest.mark.django_db
def test_authenticate_unknown_returns_none():
    assert ChzzkBackend().authenticate(None, chzzk_id="nope") is None


@pytest.mark.django_db
def test_authenticate_without_chzzk_id_returns_none():
    assert ChzzkBackend().authenticate(None) is None


@pytest.mark.django_db
def test_authenticate_inactive_returns_none():
    User.objects.create_user(chzzk_id="chan2", chzzk_nickname="N", is_active=False)
    assert ChzzkBackend().authenticate(None, chzzk_id="chan2") is None


@pytest.mark.django_db
def test_get_user_roundtrip():
    u = User.objects.create_user(chzzk_id="chan3", chzzk_nickname="N")
    assert ChzzkBackend().get_user(u.pk) == u
    assert ChzzkBackend().get_user(999999) is None

import pytest

from djclass_overlay.djclass import resolver
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken


@pytest.fixture(autouse=True)
def _clear_cache():
    resolver.badge_cache.clear()
    yield
    resolver.badge_cache.clear()


@pytest.mark.django_db
def test_unlinked_when_no_user():
    out = resolver.resolve_sender_badges("nobody", "Ghost")
    assert out == {"status": "unlinked", "badge": None}


@pytest.mark.django_db
def test_unlinked_when_no_active_varchive_token():
    User.objects.create_user(chzzk_id="c1", chzzk_nickname="N")
    out = resolver.resolve_sender_badges("c1", "N")
    assert out["status"] == "unlinked"


@pytest.mark.django_db
def test_unsynced_when_linked_but_no_rows():
    u = User.objects.create_user(chzzk_id="c2", chzzk_nickname="N")
    VarchiveToken.objects.create(user=u, token_encrypted="x", varchive_nickname="v", is_active=True)
    out = resolver.resolve_sender_badges("c2", "N")
    assert out == {"status": "unsynced", "badge": None}


@pytest.mark.django_db
def test_linked_emits_auto_and_viewer():
    u = User.objects.create_user(chzzk_id="c3", chzzk_nickname="N", preferred_button=8)
    VarchiveToken.objects.create(user=u, token_encrypted="x", varchive_nickname="v", is_active=True)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9810)
    DjClass.objects.create(user=u, button=8, dj_class="HEADLINER I", dj_power_conversion=9660)
    out = resolver.resolve_sender_badges("c3", "N")
    assert out["status"] == "linked"
    assert out["badge"]["auto"]["class"] == "SS II"      # highest class
    assert out["badge"]["viewer"]["button"] == 8         # preferred button


@pytest.mark.django_db
def test_result_is_cached(django_assert_num_queries):
    u = User.objects.create_user(chzzk_id="c4", chzzk_nickname="N")
    VarchiveToken.objects.create(user=u, token_encrypted="x", varchive_nickname="v", is_active=True)
    DjClass.objects.create(user=u, button=4, dj_class="ROOKIE I", dj_power_conversion=4900)
    first = resolver.resolve_sender_badges("c4", "N")
    # Second call hits the cache — zero DB queries.
    with django_assert_num_queries(0):
        second = resolver.resolve_sender_badges("c4", "N")
    assert first == second


@pytest.mark.django_db
def test_invalidate_user_clears_both_keys():
    from djclass_overlay.djclass import resolver
    from djclass_overlay.users.models import User

    u = User.objects.create_user(chzzk_id="cid", chzzk_nickname="nick")
    resolver.badge_cache.set("id:cid", {"status": "linked"}, 300)
    resolver.badge_cache.set("nick:nick", {"status": "linked"}, 300)
    resolver.invalidate_user(u)
    assert resolver.badge_cache.get("id:cid") is None
    assert resolver.badge_cache.get("nick:nick") is None

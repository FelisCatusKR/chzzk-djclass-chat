import pytest

from djclass_overlay.common import chzzk
from djclass_overlay.common import crypto
from djclass_overlay.streamers.models import Channel
from djclass_overlay.users.models import User


@pytest.mark.django_db
def test_login_sets_state_and_redirects(client, settings):
    settings.CHZZK_CLIENT_ID = "cid"
    settings.BASE_URL = "https://app.test"
    resp = client.get("/api/auth/chzzk", {"next": "/dashboard/"})
    assert resp.status_code == 302
    assert resp["Location"].startswith("https://chzzk.naver.com/account-interlock?")
    s = client.session
    assert len(s["oauth_state"]) == 64
    assert s["oauth_next"] == "/dashboard/"
    assert f"state={s['oauth_state']}" in resp["Location"]


@pytest.mark.django_db
def test_callback_creates_user_channel_and_logs_in(client, monkeypatch):
    monkeypatch.setattr(
        chzzk,
        "exchange_code_for_token",
        lambda code, state: {
            "access_token": "AT",
            "refresh_token": "RT",
            "expires_in": 86400,
        },
    )
    monkeypatch.setattr(
        chzzk,
        "get_user_info",
        lambda access_token: {"user_id": "chan42", "nickname": "Streamer"},
    )
    s = client.session
    s["oauth_state"] = "STATE"
    s["oauth_next"] = "/dashboard/"
    s.save()

    resp = client.get("/api/auth/chzzk/callback", {"code": "CODE", "state": "STATE"})

    assert resp.status_code == 302
    assert resp["Location"] == "/dashboard/"
    u = User.objects.get(chzzk_id="chan42")
    assert u.chzzk_nickname == "Streamer"
    assert u.has_usable_password() is False
    ch = Channel.objects.get(user=u)
    assert ch.chzzk_channel_id == "chan42"
    assert crypto.decrypt(ch.chzzk_access_token_encrypted) == "AT"
    assert crypto.decrypt(ch.chzzk_refresh_token_encrypted) == "RT"
    assert ch.token_expires_at is not None
    assert client.session["_auth_user_id"] == str(u.pk)


@pytest.mark.django_db
def test_callback_updates_existing_user_nickname(client, monkeypatch):
    User.objects.create_user(
        chzzk_id="chan42", chzzk_nickname="Old", preferred_button=6
    )
    monkeypatch.setattr(
        chzzk,
        "exchange_code_for_token",
        lambda code, state: {
            "access_token": "AT",
            "refresh_token": "RT",
            "expires_in": 86400,
        },
    )
    monkeypatch.setattr(
        chzzk,
        "get_user_info",
        lambda access_token: {"user_id": "chan42", "nickname": "New"},
    )
    s = client.session
    s["oauth_state"] = "STATE"
    s.save()
    client.get("/api/auth/chzzk/callback", {"code": "CODE", "state": "STATE"})
    u = User.objects.get(chzzk_id="chan42")
    assert u.chzzk_nickname == "New"
    assert u.preferred_button == 6  # untouched


@pytest.mark.django_db
def test_callback_state_mismatch_redirects_to_error(client):
    s = client.session
    s["oauth_state"] = "GOOD"
    s.save()
    resp = client.get("/api/auth/chzzk/callback", {"code": "C", "state": "BAD"})
    assert resp.status_code == 302
    assert "error=auth_failed" in resp["Location"]
    assert User.objects.count() == 0


@pytest.mark.django_db
def test_callback_upstream_failure_redirects_to_error(client, monkeypatch):
    def boom(code, state):
        raise RuntimeError("chzzk down")

    monkeypatch.setattr(chzzk, "exchange_code_for_token", boom)
    s = client.session
    s["oauth_state"] = "STATE"
    s.save()
    resp = client.get("/api/auth/chzzk/callback", {"code": "C", "state": "STATE"})
    assert resp.status_code == 302
    assert "error=auth_failed" in resp["Location"]
    assert User.objects.count() == 0

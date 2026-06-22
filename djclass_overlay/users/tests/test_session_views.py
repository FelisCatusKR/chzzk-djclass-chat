import pytest

from djclass_overlay.users.models import User

BACKEND = "djclass_overlay.users.backends.ChzzkBackend"


def test_login_page_renders_with_next(client):
    resp = client.get("/login/", {"next": "/dashboard/"})
    assert resp.status_code == 200
    assert b"/api/auth/chzzk" in resp.content


@pytest.mark.django_db
def test_login_page_redirects_when_authenticated(client):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="N")
    client.force_login(u, backend=BACKEND)
    resp = client.get("/login/")
    assert resp.status_code == 302
    assert resp["Location"] == "/dashboard/"


def test_dashboard_requires_login(client):
    resp = client.get("/dashboard/")
    assert resp.status_code == 302
    assert "/login/" in resp["Location"]
    assert "next=/dashboard/" in resp["Location"]


@pytest.mark.django_db
def test_dashboard_renders_for_authenticated_user(client):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="Streamer")
    client.force_login(u, backend=BACKEND)
    resp = client.get("/dashboard/")
    assert resp.status_code == 200
    assert "Streamer".encode() in resp.content


@pytest.mark.django_db
def test_logout_clears_session(client):
    u = User.objects.create_user(chzzk_id="c", chzzk_nickname="N")
    client.force_login(u, backend=BACKEND)
    assert "_auth_user_id" in client.session
    resp = client.post("/logout/")
    assert resp.status_code == 302
    assert "_auth_user_id" not in client.session


@pytest.mark.django_db
def test_logout_rejects_get(client):
    resp = client.get("/logout/")
    assert resp.status_code == 405

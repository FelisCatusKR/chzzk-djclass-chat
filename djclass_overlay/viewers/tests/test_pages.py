import pytest

from djclass_overlay.users.models import User

BACKEND = "djclass_overlay.users.backends.ChzzkBackend"


def test_link_requires_login(client):
    resp = client.get("/link/")
    assert resp.status_code == 302
    assert "/login/" in resp["Location"]
    assert "next=/link/" in resp["Location"]


@pytest.mark.django_db
def test_link_placeholder_renders_for_authed(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    resp = client.get("/link/")
    assert resp.status_code == 200
    assert "준비 중" in resp.content.decode()

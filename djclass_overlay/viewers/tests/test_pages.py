import pytest

from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken

BACKEND = "djclass_overlay.users.backends.ChzzkBackend"


def test_link_requires_login(client):
    resp = client.get("/link/")
    assert resp.status_code == 302
    assert "/login/" in resp["Location"]
    assert "next=/link/" in resp["Location"]


@pytest.mark.django_db
def test_link_not_linked_state(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    body = client.get("/link/").content.decode()
    assert "DJ CLASS 연동" in body
    assert "조회토큰을 입력하세요" in body
    assert "V-ARCHIVE 마이페이지" in body
    assert 'hx-post="/link/connect/"' in body
    assert "버튼 선택" not in body  # no picker when not linked


@pytest.mark.django_db
def test_link_linked_state_shows_actions_and_buttons(client):
    u = User.objects.create_user(chzzk_id="v2", chzzk_nickname="Viewer2")
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    DjClass.objects.create(
        user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0
    )
    client.force_login(u, backend=BACKEND)
    body = client.get("/link/").content.decode()
    assert "V-ARCHIVE 연동 완료" in body
    assert 'hx-post="/link/sync/"' in body
    assert 'hx-post="/link/unlink/"' in body
    assert "버튼 선택" in body
    assert "자동 (최고 클래스)" in body
    assert "4버튼" in body
    assert "SS II" in body  # compact rank chip (build_badge "class")
    assert "9823" in body  # power chip


@pytest.mark.django_db
def test_link_card_scopes_swaps_to_itself(client):
    # The #link-card forms must NOT inherit the <body> app-shell hx-select="#content":
    # their hx-post responses are #link-card fragments with no #content, so htmx would
    # build an empty fragment and EMPTY the card. The container re-declares hx-select
    # to itself (+ opts out of boost). Regression guard for that swap bug.
    u = User.objects.create_user(chzzk_id="v3", chzzk_nickname="Viewer3")
    client.force_login(u, backend=BACKEND)
    body = client.get("/link/").content.decode()
    assert 'id="link-card"' in body
    assert 'hx-select="#link-card"' in body
    # The explanatory note must be a real (stripped) template comment, not leaked text.
    assert "pin the forms below" not in body

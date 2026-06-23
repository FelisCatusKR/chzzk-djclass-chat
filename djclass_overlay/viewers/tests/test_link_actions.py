import pytest

from djclass_overlay.djclass import varchive
from djclass_overlay.djclass.models import DjClass
from djclass_overlay.users.models import User
from djclass_overlay.viewers.models import VarchiveToken

BACKEND = "djclass_overlay.users.backends.ChzzkBackend"

CLASSES = [{"button": 4, "djClass": "SHOWSTOPPER II", "djPowerSum": 1.0,
            "maxDjPower": 2.0, "djPowerConversion": 9823.0}]


# --- connect ---

@pytest.mark.django_db
def test_connect_valid_token_links_and_syncs(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    monkeypatch.setattr(varchive, "lookup_user",
                        lambda tok: {"user_no": 7, "nickname": "VA-Nick"})
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: CLASSES)

    resp = client.post("/link/connect/", {"token": "good-token"})
    body = resp.content.decode()

    assert resp.status_code == 200
    assert "<!doctype" not in body.lower()                 # a fragment, not a full page
    assert "연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다." in body
    assert "V-ARCHIVE 연동 완료" in body                    # linked state
    link = VarchiveToken.objects.get(user=u)
    assert link.varchive_nickname == "VA-Nick"
    assert link.varchive_user_no == 7
    assert link.is_active is True
    assert DjClass.objects.filter(user=u).count() == 1


@pytest.mark.django_db
def test_connect_invalid_token_shows_error(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)

    def _raise(tok):
        raise varchive.InvalidToken()

    monkeypatch.setattr(varchive, "lookup_user", _raise)
    resp = client.post("/link/connect/", {"token": "bad"})
    assert "조회토큰이 유효하지 않습니다. 다시 확인해주세요." in resp.content.decode()
    assert not VarchiveToken.objects.filter(user=u).exists()


@pytest.mark.django_db
def test_connect_network_error_shows_error(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)

    def _raise(tok):
        raise varchive.VarchiveError()

    monkeypatch.setattr(varchive, "lookup_user", _raise)
    resp = client.post("/link/connect/", {"token": "x"})
    assert "네트워크 오류가 발생했습니다." in resp.content.decode()
    assert not VarchiveToken.objects.filter(user=u).exists()


@pytest.mark.django_db
def test_connect_empty_token_shows_error(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/connect/", {"token": "   "})
    assert "조회토큰을 입력하세요." in resp.content.decode()


# --- sync ---

@pytest.mark.django_db
def test_sync_success_reports_highest(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    client.force_login(u, backend=BACKEND)
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: CLASSES)
    resp = client.post("/link/sync/")
    assert "DJ CLASS 동기화 완료: 4B SHOWSTOPPER II" in resp.content.decode()
    assert DjClass.objects.filter(user=u).count() == 1


@pytest.mark.django_db
def test_sync_empty_with_existing_rows_prompts_relink(client, monkeypatch):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0)
    client.force_login(u, backend=BACKEND)
    monkeypatch.setattr(varchive, "get_all_dj_classes", lambda nick: [])
    resp = client.post("/link/sync/")
    assert "다시 연동" in resp.content.decode()
    assert DjClass.objects.filter(user=u).count() == 1     # not wiped


@pytest.mark.django_db
def test_sync_without_link_errors(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/sync/")
    assert "먼저 V-ARCHIVE를 연동해주세요." in resp.content.decode()


# --- unlink ---

@pytest.mark.django_db
def test_unlink_deactivates_and_clears(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    u.preferred_button = 4
    u.save(update_fields=["preferred_button"])
    link = VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    DjClass.objects.create(user=u, button=4, dj_class="SHOWSTOPPER II", dj_power_conversion=9823.0)
    client.force_login(u, backend=BACKEND)

    resp = client.post("/link/unlink/")
    body = resp.content.decode()

    assert "V-ARCHIVE 연동을 해제했습니다." in body
    assert "조회토큰을 입력하세요" in body                 # back to not-linked state
    link.refresh_from_db()
    u.refresh_from_db()
    assert link.is_active is False
    assert DjClass.objects.filter(user=u).count() == 0
    assert u.preferred_button is None


# --- preferred button ---

def _link_with_buttons(u, buttons):
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    for b in buttons:
        DjClass.objects.create(user=u, button=b, dj_class="SHOWSTOPPER II",
                               dj_power_conversion=9823.0)


@pytest.mark.django_db
def test_preferred_button_set_valid(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    _link_with_buttons(u, [4, 8])
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/preferred-button/", {"button": "8"})
    assert resp.status_code == 200
    u.refresh_from_db()
    assert u.preferred_button == 8


@pytest.mark.django_db
def test_preferred_button_auto_clears(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    u.preferred_button = 4
    u.save(update_fields=["preferred_button"])
    _link_with_buttons(u, [4, 8])
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/preferred-button/", {"button": "auto"})
    assert resp.status_code == 200
    assert "자동 (최고 클래스)" in resp.content.decode()   # re-rendered picker fragment
    u.refresh_from_db()
    assert u.preferred_button is None


@pytest.mark.django_db
def test_preferred_button_invalid_rejected(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    _link_with_buttons(u, [4, 8])
    client.force_login(u, backend=BACKEND)
    resp = client.post("/link/preferred-button/", {"button": "5"})   # no 5 row
    assert "잘못된 버튼 선택입니다." in resp.content.decode()
    u.refresh_from_db()
    assert u.preferred_button is None


@pytest.mark.django_db
def test_link_sync_rate_limited(client, monkeypatch):
    from djclass_overlay.common import ratelimit

    u = User.objects.create_user(chzzk_id="rl1", chzzk_nickname="RL")
    VarchiveToken.objects.create(user=u, varchive_nickname="VA", varchive_user_no=7)
    client.force_login(u, backend=BACKEND)
    monkeypatch.setattr(ratelimit, "allow", lambda *a, **k: False)
    resp = client.post("/link/sync/")
    assert resp.status_code == 200                       # htmx-swappable fragment
    assert "요청이 너무 많습니다" in resp.content.decode()

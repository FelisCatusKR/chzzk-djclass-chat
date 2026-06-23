import httpx
import pytest

from djclass_overlay.djclass import varchive


def test_lookup_user_ok(httpx_mock):
    httpx_mock.add_response(
        url="https://v-archive.net/api/v2/open-token/user",
        json={"success": True, "userNo": 4242, "nickname": "VA-Nick"},
    )
    info = varchive.lookup_user("tok")
    assert info == {"user_no": 4242, "nickname": "VA-Nick"}


def test_lookup_user_401_is_invalid(httpx_mock):
    httpx_mock.add_response(
        url="https://v-archive.net/api/v2/open-token/user", status_code=401
    )
    with pytest.raises(varchive.InvalidToken):
        varchive.lookup_user("bad")


def test_lookup_user_success_false_is_invalid(httpx_mock):
    httpx_mock.add_response(
        url="https://v-archive.net/api/v2/open-token/user",
        json={"success": False},
    )
    with pytest.raises(varchive.InvalidToken):
        varchive.lookup_user("tok")


def test_lookup_user_missing_fields_is_invalid(httpx_mock):
    # success=true but no userNo/nickname (API-contract violation) must not 500.
    httpx_mock.add_response(
        url="https://v-archive.net/api/v2/open-token/user",
        json={"success": True},
    )
    with pytest.raises(varchive.InvalidToken):
        varchive.lookup_user("tok")


def test_get_all_dj_classes_skips_failures(httpx_mock):
    base = "https://v-archive.net/api/v2/archive/VA-Nick/djClass"
    httpx_mock.add_response(
        url=f"{base}/4",
        json={"success": True, "djClass": "SHOWSTOPPER II",
              "djPowerSum": 1.0, "maxDjPower": 2.0, "djPowerConversion": 9823.0},
    )
    httpx_mock.add_response(url=f"{base}/5", status_code=404)
    httpx_mock.add_response(url=f"{base}/6", status_code=404)
    httpx_mock.add_response(
        url=f"{base}/8",
        json={"success": True, "djClass": "HEADLINER IV",
              "djPowerSum": 3.0, "maxDjPower": 4.0, "djPowerConversion": 9410.0},
    )
    rows = varchive.get_all_dj_classes("VA-Nick")
    assert [r["button"] for r in rows] == [4, 8]
    assert rows[0]["djClass"] == "SHOWSTOPPER II"
    assert rows[0]["djPowerConversion"] == 9823.0


def test_lookup_user_network_error_is_varchive_error(httpx_mock):
    httpx_mock.add_exception(
        httpx.ConnectError("boom"),
        url="https://v-archive.net/api/v2/open-token/user",
    )
    with pytest.raises(varchive.VarchiveError):
        varchive.lookup_user("tok")

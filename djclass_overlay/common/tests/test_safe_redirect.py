from djclass_overlay.common.safe_redirect import safe_next_path


def test_valid_relative_path():
    assert safe_next_path("/dashboard/") == "/dashboard/"


def test_none_falls_back():
    assert safe_next_path(None) == "/dashboard/"
    assert safe_next_path("") == "/dashboard/"


def test_absolute_url_rejected():
    assert safe_next_path("https://evil.test/x") == "/dashboard/"


def test_non_slash_rejected():
    assert safe_next_path("dashboard") == "/dashboard/"


def test_protocol_relative_rejected():
    assert safe_next_path("//evil.test") == "/dashboard/"


def test_backslash_trick_rejected():
    assert safe_next_path("/\\evil.test") == "/dashboard/"


def test_custom_fallback():
    assert safe_next_path(None, fallback="/link/") == "/link/"

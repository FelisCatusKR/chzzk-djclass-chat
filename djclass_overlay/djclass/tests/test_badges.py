import pytest

from djclass_overlay.djclass import badges


def test_constants():
    assert badges.THEORY_POWER_THRESHOLD == 10000
    assert badges.THEORY_POWER_CONVERSION_THRESHOLD == 9999.9847
    assert len(badges.RANK_ORDER) == 14
    assert badges.RANK_ORDER[0] == "THE LORD OF DJMAX"
    assert badges.RANK_ORDER[-1] == "BEGINNER"
    assert badges.SHORT_NAMES["SHOWSTOPPER"] == "SS"
    assert badges.SHORT_NAMES["THE LORD OF DJMAX"] == "LoD"


def test_is_theory_power():
    assert badges.is_theory_power(10000) is True
    assert badges.is_theory_power(10001) is True
    assert badges.is_theory_power(9999) is False
    assert badges.is_theory_power(None) is False


def test_is_theory_conversion():
    assert badges.is_theory_conversion(9999.9847) is True
    assert badges.is_theory_conversion(10000) is True
    assert badges.is_theory_conversion(9999.9846) is False
    assert badges.is_theory_conversion(9999.5) is False
    assert badges.is_theory_conversion(None) is False


def test_to_power_integer():
    assert badges.to_power_integer(9999.9847) == 10000  # theory bump
    assert badges.to_power_integer(10000) == 10000
    assert badges.to_power_integer(9999.9846) == 9999  # floor
    assert badges.to_power_integer(9999.5) == 9999
    assert badges.to_power_integer(8800.7) == 8800
    assert badges.to_power_integer(0) == 0  # genuine zero preserved
    assert badges.to_power_integer(None) is None


def test_parse_rank_name():
    assert badges.parse_rank_name("SHOWSTOPPER II") == "SHOWSTOPPER"
    assert (
        badges.parse_rank_name("4B SHOWSTOPPER II") == "SHOWSTOPPER"
    )  # strips button prefix
    assert badges.parse_rank_name("THE LORD OF DJMAX") == "THE LORD OF DJMAX"
    assert badges.parse_rank_name(None) == "BEGINNER"
    assert badges.parse_rank_name("") == "BEGINNER"


def test_extract_level():
    assert badges.extract_level("SHOWSTOPPER II") == "II"
    assert badges.extract_level("THE LORD OF DJMAX") is None
    assert badges.extract_level("4B HEADLINER IV") == "IV"


def test_get_threshold():
    assert (
        badges.get_threshold("THE LORD OF DJMAX", None) == 9980
    )  # default ignores level
    assert badges.get_threshold("SHOWSTOPPER", "II") == 9800
    assert badges.get_threshold("BEGINNER", None) == 0  # default
    assert badges.get_threshold("UNKNOWN RANK", "II") is None  # unknown rank
    assert (
        badges.get_threshold("SHOWSTOPPER", None) is None
    )  # rank needs a level, none given


def test_validate_preferred_button():
    assert badges.validate_preferred_button(None, [4, 8]) is None
    assert badges.validate_preferred_button(8, [4, 8]) == 8
    with pytest.raises(ValueError):
        badges.validate_preferred_button(5, [4, 8])

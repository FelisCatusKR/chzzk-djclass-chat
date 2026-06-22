from dataclasses import dataclass

from djclass_overlay.djclass import badges


@dataclass
class Row:
    button: int
    dj_class: str
    dj_power_conversion: float | None


def test_sort_key_basic():
    # SHOWSTOPPER (idx 2 → ordinal 11), level IV (1), button 4 (0)
    assert badges.get_class_sort_key("SHOWSTOPPER IV", 9700, 4) == (11, 1, 0)


def test_sort_key_theory_lod_is_level_5():
    # raw 9999.9847 on LoD → level 5; plain LoD → level 0
    assert badges.get_class_sort_key("THE LORD OF DJMAX", 9999.9847, 4) == (13, 5, 0)
    assert badges.get_class_sort_key("THE LORD OF DJMAX", 9999.5, 4) == (13, 0, 0)


def test_sort_key_button_preference_8_5_6_4():
    # same rank+level, button preference 8 > 5 > 6 > 4
    assert badges.get_class_sort_key("ROOKIE I", 4900, 8)[2] == 3
    assert badges.get_class_sort_key("ROOKIE I", 4900, 5)[2] == 2
    assert badges.get_class_sort_key("ROOKIE I", 4900, 6)[2] == 1
    assert badges.get_class_sort_key("ROOKIE I", 4900, 4)[2] == 0


def test_sort_key_unknown_rank():
    assert badges.get_class_sort_key("NONSENSE II", 100, 4)[0] == -1


def test_resolve_auto_picks_highest_class():
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9660)]
    chosen = badges.resolve_displayed_class(rows, None, "auto")
    assert chosen.dj_class == "SHOWSTOPPER II"   # higher rank wins over higher button


def test_resolve_auto_class_beats_raw_power():
    # lower rank but higher power must lose — selection is by CLASS, not power
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9999)]
    assert badges.resolve_displayed_class(rows, None, "auto").dj_class == "SHOWSTOPPER II"


def test_resolve_viewer_prefers_preferred_button():
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9660)]
    chosen = badges.resolve_displayed_class(rows, 8, "viewer")
    assert chosen.button == 8                    # preferred even though not highest class


def test_resolve_viewer_falls_back_when_preferred_missing():
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9660)]
    chosen = badges.resolve_displayed_class(rows, 6, "viewer")  # no button-6 row
    assert chosen.dj_class == "SHOWSTOPPER II"


def test_resolve_viewer_falls_back_when_no_preference():
    rows = [Row(4, "SHOWSTOPPER II", 9810), Row(8, "HEADLINER I", 9660)]
    assert badges.resolve_displayed_class(rows, None, "viewer").dj_class == "SHOWSTOPPER II"


def test_resolve_empty_is_none():
    assert badges.resolve_displayed_class([], None, "auto") is None


def test_build_badge_short_class_and_fields():
    badge = badges.build_badge(Row(4, "SHOWSTOPPER II", 9810))
    assert badge == {
        "button": 4,
        "class": "SS II",
        "rank": "SS",
        "power": 9810,
        "threshold": 9800,
        "isTheory": False,
    }


def test_build_badge_theory_lod():
    badge = badges.build_badge(Row(8, "THE LORD OF DJMAX", 9999.9847))
    assert badge == {
        "button": 8,
        "class": "LoD",        # level-less rank → no trailing level
        "rank": "LoD",
        "power": 10000,        # theory bump
        "threshold": 9980,
        "isTheory": True,
    }

# ruff: noqa: INP001, T201 — standalone generator script, not a package module
"""Regenerate python_golden.json from the Django implementation (parity oracle).

Run from the repo root:
    PYTHONPATH=. uv run python go/internal/djclass/testdata/gen_golden.py
"""

import itertools
import json
from dataclasses import dataclass
from pathlib import Path

from djclass_overlay.djclass import badges

CLASSES = [
    *(f"{r} {lv}" for r in badges.RANK_ORDER for lv in ("I", "II", "III", "IV")),
    "THE LORD OF DJMAX",
    "BEGINNER",
    "4B SHOWSTOPPER II",
    "rookie iv",
    "PRO DJ V",
    "NONSENSE II",
    "",
    "  HEADLINER   I",
]
CONVERSIONS = [
    None,
    0,
    0.5,
    4900,
    8800.7,
    9810,
    9999.5,
    9999.9846,
    9999.9847,
    10000,
    10001.2,
]
BUTTONS = [4, 5, 6, 8, 7]


@dataclass
class Row:
    button: int
    dj_class: str
    dj_power_conversion: float | None


# Every class x conversion once; buttons cycle so each one (incl. invalid 7) appears.
rows = [
    Row(BUTTONS[i % len(BUTTONS)], c, v)
    for i, (c, v) in enumerate(itertools.product(CLASSES, CONVERSIONS))
]
single = [
    {
        "button": r.button,
        "class": r.dj_class,
        "conversion": r.dj_power_conversion,
        "sortKey": list(
            badges.get_class_sort_key(r.dj_class, r.dj_power_conversion, r.button)
        ),
        "badge": badges.build_badge(r),
    }
    for r in rows
]
# Deterministic multi-row selections: sliding windows over the row list.
resolve = []
for start in range(0, len(rows) - 4, 37):
    window = rows[start : start + 4]
    for pref, sel in [
        (None, "auto"),
        (None, "viewer"),
        (window[2].button, "viewer"),
        (6, "viewer"),
    ]:
        chosen = badges.resolve_displayed_class(window, pref, sel)
        resolve.append(
            {
                "rows": [r.__dict__ for r in window],
                "preferred": pref,
                "sel": sel,
                "index": window.index(chosen),
            }
        )

out = Path(__file__).with_name("python_golden.json")
out.write_text(json.dumps({"single": single, "resolve": resolve}, ensure_ascii=False))
print(f"wrote {len(single)} single + {len(resolve)} resolve cases to {out}")

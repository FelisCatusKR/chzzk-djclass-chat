"""Pure DJ CLASS badge logic. 1:1 port of src/lib/dj-class.ts (no DB, no Django).

The server pre-resolves these atomic fields and the widget concatenates them per
its display mode, so the rank/level/threshold/theory rules live here once.
"""

import math
import re

# --- theory thresholds (dj-class.ts:6, :17) ---
THEORY_POWER_THRESHOLD = 10000
# V-ARCHIVE reports true in-game theory as a float slightly below 10000
# (observed 9999.9847); treat that as theory on the RAW conversion value.
THEORY_POWER_CONVERSION_THRESHOLD = 9999.9847

# --- rank ordering, best→worst (dj-class.ts:124) ---
RANK_ORDER = [
    "THE LORD OF DJMAX",
    "BEAT MAESTRO",
    "SHOWSTOPPER",
    "HEADLINER",
    "TREND SETTER",
    "PROFESSIONAL",
    "HIGH CLASS",
    "PRO DJ",
    "MIDDLEMAN",
    "STREET DJ",
    "ROOKIE",
    "AMATEUR",
    "TRAINEE",
    "BEGINNER",
]

# --- approximate DJ POWER floor per rank/level (dj-class.ts:77) ---
RANK_THRESHOLDS = {
    "THE LORD OF DJMAX": {"default": 9980},
    "BEAT MAESTRO": {"IV": 9900, "III": 9930, "II": 9950, "I": 9970},
    "SHOWSTOPPER": {"IV": 9700, "III": 9750, "II": 9800, "I": 9850},
    "HEADLINER": {"IV": 9400, "III": 9500, "II": 9600, "I": 9650},
    "TREND SETTER": {"IV": 9000, "III": 9100, "II": 9200, "I": 9300},
    "PROFESSIONAL": {"IV": 8600, "III": 8700, "II": 8800, "I": 8900},
    "HIGH CLASS": {"IV": 7800, "III": 8000, "II": 8200, "I": 8400},
    "PRO DJ": {"IV": 7000, "III": 7200, "II": 7400, "I": 7600},
    "MIDDLEMAN": {"IV": 6200, "III": 6400, "II": 6600, "I": 6800},
    "STREET DJ": {"IV": 5200, "III": 5500, "II": 5800, "I": 6000},
    "ROOKIE": {"IV": 4000, "III": 4300, "II": 4600, "I": 4900},
    "AMATEUR": {"IV": 2400, "III": 2800, "II": 3200, "I": 3600},
    "TRAINEE": {"IV": 500, "III": 1000, "II": 1500, "I": 2000},
    "BEGINNER": {"default": 0},
}

# --- short labels (dj-class.ts:59) ---
SHORT_NAMES = {
    "THE LORD OF DJMAX": "LoD",
    "BEAT MAESTRO": "BM",
    "SHOWSTOPPER": "SS",
    "HEADLINER": "HL",
    "TREND SETTER": "TS",
    "PROFESSIONAL": "PRO",
    "HIGH CLASS": "HC",
    "PRO DJ": "PD",
    "MIDDLEMAN": "MM",
    "STREET DJ": "SD",
    "ROOKIE": "RK",
    "AMATEUR": "AM",
    "TRAINEE": "TR",
    "BEGINNER": "BG",
}

# Roman level → ordinal, higher is better (dj-class.ts:142). Theory LoD = 5 (set in sort key).
LEVEL_VALUES = {"I": 4, "II": 3, "III": 2, "IV": 1}
# Button display preference: 8 > 5 > 6 > 4 (dj-class.ts:145) — note 6 sits BELOW 5.
BUTTON_PREFERENCE = {8: 3, 5: 2, 6: 1, 4: 0}

_LEVEL_RE = re.compile(r"\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$", re.IGNORECASE)
_PREFIX_RE = re.compile(r"^\d+B\s+")


def is_theory_power(power_integer):
    return power_integer is not None and power_integer >= THEORY_POWER_THRESHOLD


def is_theory_conversion(conversion):
    return conversion is not None and conversion >= THEORY_POWER_CONVERSION_THRESHOLD


def to_power_integer(conversion):
    if conversion is None:
        return None
    if is_theory_conversion(conversion):
        return THEORY_POWER_THRESHOLD
    return math.floor(conversion)


def parse_rank_name(dj_class):
    if not dj_class:
        return "BEGINNER"
    stripped = _PREFIX_RE.sub("", dj_class)
    stripped = _LEVEL_RE.sub("", stripped).strip()
    return stripped or "BEGINNER"


def extract_level(dj_class):
    if not dj_class:
        return None
    match = _LEVEL_RE.search(dj_class)
    return match.group(1).upper() if match else None


def get_threshold(rank_name, rank_level):
    thresholds = RANK_THRESHOLDS.get(rank_name)
    if not thresholds:
        return None
    if thresholds.get("default") is not None:
        return thresholds["default"]
    if rank_level is not None and thresholds.get(rank_level) is not None:
        return thresholds[rank_level]
    return None


def get_class_sort_key(dj_class, dj_power_conversion, button):
    """Port of dj-class.ts:147. Returns (rank_ordinal, level_ordinal, button_pref);
    bigger is better at every position, compared lexicographically (Python tuple order)."""
    rank_name = parse_rank_name(dj_class)
    try:
        rank_index = RANK_ORDER.index(rank_name)
        rank_ordinal = len(RANK_ORDER) - 1 - rank_index
    except ValueError:
        rank_ordinal = -1

    if rank_name == "THE LORD OF DJMAX" and is_theory_conversion(dj_power_conversion):
        level_ordinal = 5
    else:
        level = extract_level(dj_class)
        level_ordinal = LEVEL_VALUES.get(level, 0) if level else 0

    button_pref = BUTTON_PREFERENCE.get(button, -1)
    return (rank_ordinal, level_ordinal, button_pref)


def resolve_displayed_class(rows, preferred_button, sel):
    """Port of dj-class.ts:212. `rows` = objects with .button/.dj_class/.dj_power_conversion."""
    if not rows:
        return None
    if sel == "viewer" and preferred_button is not None:
        for row in rows:
            if row.button == preferred_button:
                return row
    # Highest CLASS by sort key. max() returns the first maximal row on ties,
    # matching the JS reduce that keeps the earlier `best` on a tie.
    return max(
        rows,
        key=lambda r: get_class_sort_key(r.dj_class, r.dj_power_conversion, r.button),
    )


def build_badge(row):
    """Compose the atomic SSE badge fields (spec §4.4.1) from a chosen DJ CLASS row.

    `class` = short rank + level (e.g. "SS II", or "LoD" for level-less ranks);
    `rank`  = short rank only (color/authority key); the widget prepends "<button>B".
    """
    rank_name = parse_rank_name(row.dj_class)
    level = extract_level(row.dj_class)
    rank_short = SHORT_NAMES.get(rank_name, rank_name)
    power = to_power_integer(row.dj_power_conversion)
    return {
        "button": row.button,
        "class": f"{rank_short} {level}" if level else rank_short,
        "rank": rank_short,
        "power": power,
        "threshold": get_threshold(rank_name, level),
        "isTheory": is_theory_power(power),
    }


def validate_preferred_button(button, available_buttons):
    """Port of dj-class.ts:246. None -> None; an int in `available_buttons` -> it;
    anything else -> ValueError."""
    if button is None:
        return None
    if isinstance(button, int) and button in available_buttons:
        return button
    raise ValueError("Invalid preferred button")

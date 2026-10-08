// Package djclass is the pure DJ CLASS badge logic (no DB, no I/O): which of a
// player's per-button classes to show, and the atomic badge fields the widget
// renders. 1:1 port of djclass_overlay/djclass/badges.py (itself a port of the
// original src/lib/dj-class.ts) — keep the rules here and nowhere else.
package djclass

import (
	"math"
	"regexp"
	"slices"
	"strings"
)

const (
	TheoryPower = 10000
	// V-ARCHIVE reports true in-game theory as a float slightly below 10000
	// (observed 9999.9847); treat that as theory on the RAW conversion value.
	TheoryConversion = 9999.9847
)

// RankOrder lists ranks best → worst.
var RankOrder = []string{
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
}

// rankThresholds is the approximate DJ POWER floor per rank and level; ranks
// without levels use "default".
var rankThresholds = map[string]map[string]int{
	"THE LORD OF DJMAX": {"default": 9980},
	"BEAT MAESTRO":      {"IV": 9900, "III": 9930, "II": 9950, "I": 9970},
	"SHOWSTOPPER":       {"IV": 9700, "III": 9750, "II": 9800, "I": 9850},
	"HEADLINER":         {"IV": 9400, "III": 9500, "II": 9600, "I": 9650},
	"TREND SETTER":      {"IV": 9000, "III": 9100, "II": 9200, "I": 9300},
	"PROFESSIONAL":      {"IV": 8600, "III": 8700, "II": 8800, "I": 8900},
	"HIGH CLASS":        {"IV": 7800, "III": 8000, "II": 8200, "I": 8400},
	"PRO DJ":            {"IV": 7000, "III": 7200, "II": 7400, "I": 7600},
	"MIDDLEMAN":         {"IV": 6200, "III": 6400, "II": 6600, "I": 6800},
	"STREET DJ":         {"IV": 5200, "III": 5500, "II": 5800, "I": 6000},
	"ROOKIE":            {"IV": 4000, "III": 4300, "II": 4600, "I": 4900},
	"AMATEUR":           {"IV": 2400, "III": 2800, "II": 3200, "I": 3600},
	"TRAINEE":           {"IV": 500, "III": 1000, "II": 1500, "I": 2000},
	"BEGINNER":          {"default": 0},
}

var shortNames = map[string]string{
	"THE LORD OF DJMAX": "LoD",
	"BEAT MAESTRO":      "BM",
	"SHOWSTOPPER":       "SS",
	"HEADLINER":         "HL",
	"TREND SETTER":      "TS",
	"PROFESSIONAL":      "PRO",
	"HIGH CLASS":        "HC",
	"PRO DJ":            "PD",
	"MIDDLEMAN":         "MM",
	"STREET DJ":         "SD",
	"ROOKIE":            "RK",
	"AMATEUR":           "AM",
	"TRAINEE":           "TR",
	"BEGINNER":          "BG",
}

// Roman level → ordinal, higher is better. Theory LoD counts as 5 (sortKey).
var levelValues = map[string]int{"I": 4, "II": 3, "III": 2, "IV": 1}

// Button display preference on ties: 8 > 5 > 6 > 4 (6 sits BELOW 5).
var buttonPreference = map[int]int{8: 3, 5: 2, 6: 1, 4: 0}

var (
	levelRe  = regexp.MustCompile(`(?i)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X)$`)
	prefixRe = regexp.MustCompile(`^\d+B\s+`)
)

// Row is one stored per-button class.
type Row struct {
	Button     int
	Class      string   // e.g. "SHOWSTOPPER II"
	Conversion *float64 // DJ POWER conversion; nil if unknown
}

// Badge is the atomic SSE badge payload; the widget prepends "<button>B".
type Badge struct {
	Button    int    `json:"button"`
	Class     string `json:"class"` // short rank + level, e.g. "SS II" or "LoD"
	Rank      string `json:"rank"`  // short rank only (color key)
	Power     *int   `json:"power"`
	Threshold *int   `json:"threshold"`
	IsTheory  bool   `json:"isTheory"`
}

func IsTheoryPower(power *int) bool { return power != nil && *power >= TheoryPower }

func IsTheoryConversion(conv *float64) bool { return conv != nil && *conv >= TheoryConversion }

func ToPowerInteger(conv *float64) *int {
	if conv == nil {
		return nil
	}
	p := int(math.Floor(*conv))
	if IsTheoryConversion(conv) {
		p = TheoryPower
	}
	return &p
}

func ParseRankName(class string) string {
	s := prefixRe.ReplaceAllString(class, "")
	s = strings.TrimSpace(levelRe.ReplaceAllString(s, ""))
	if s == "" {
		return "BEGINNER"
	}
	return s
}

// ExtractLevel returns the upper-cased roman level, or "" if there is none.
func ExtractLevel(class string) string {
	m := levelRe.FindStringSubmatch(class)
	if m == nil {
		return ""
	}
	return strings.ToUpper(m[1])
}

func Threshold(rank, level string) *int {
	t, ok := rankThresholds[rank]
	if !ok {
		return nil
	}
	if v, ok := t["default"]; ok {
		return &v
	}
	if v, ok := t[level]; ok && level != "" {
		return &v
	}
	return nil
}

// SortKey is (rank ordinal, level ordinal, button preference), bigger is better,
// compared lexicographically.
func SortKey(r Row) [3]int {
	rank := ParseRankName(r.Class)
	rankOrd := -1
	if i := slices.Index(RankOrder, rank); i >= 0 {
		rankOrd = len(RankOrder) - 1 - i
	}
	levelOrd := 0
	if rank == "THE LORD OF DJMAX" && IsTheoryConversion(r.Conversion) {
		levelOrd = 5
	} else if lv := ExtractLevel(r.Class); lv != "" {
		levelOrd = levelValues[lv]
	}
	buttonPref, ok := buttonPreference[r.Button]
	if !ok {
		buttonPref = -1
	}
	return [3]int{rankOrd, levelOrd, buttonPref}
}

type Selection int

const (
	Auto   Selection = iota // highest class
	Viewer                  // the viewer's preferred button, else Auto
)

// Resolve picks the row to display, or false when rows is empty. On ties the
// first maximal row wins (same as Python's max / the JS reduce).
func Resolve(rows []Row, preferredButton *int, sel Selection) (Row, bool) {
	if len(rows) == 0 {
		return Row{}, false
	}
	if sel == Viewer && preferredButton != nil {
		for _, r := range rows {
			if r.Button == *preferredButton {
				return r, true
			}
		}
	}
	best, bestKey := rows[0], SortKey(rows[0])
	for _, r := range rows[1:] {
		if k := SortKey(r); slices.Compare(k[:], bestKey[:]) > 0 {
			best, bestKey = r, k
		}
	}
	return best, true
}

func BuildBadge(r Row) Badge {
	rank := ParseRankName(r.Class)
	level := ExtractLevel(r.Class)
	short, ok := shortNames[rank]
	if !ok {
		short = rank
	}
	class := short
	if level != "" {
		class += " " + level
	}
	power := ToPowerInteger(r.Conversion)
	return Badge{
		Button:    r.Button,
		Class:     class,
		Rank:      short,
		Power:     power,
		Threshold: Threshold(rank, level),
		IsTheory:  IsTheoryPower(power),
	}
}

// ValidPreferredButton reports whether button may be stored as the viewer's
// preference: nil (auto) or one of the buttons the viewer has a class for.
func ValidPreferredButton(button *int, available []int) bool {
	return button == nil || slices.Contains(available, *button)
}

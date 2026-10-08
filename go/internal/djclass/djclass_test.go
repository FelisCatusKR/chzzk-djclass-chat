package djclass

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// Ported from djclass_overlay/djclass/tests/test_badges.py and test_selection.py.

func f(v float64) *float64 { return &v }
func i(v int) *int         { return &v }

func intOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestConstants(t *testing.T) {
	if len(RankOrder) != 14 || RankOrder[0] != "THE LORD OF DJMAX" || RankOrder[13] != "BEGINNER" {
		t.Errorf("RankOrder = %v", RankOrder)
	}
	if shortNames["SHOWSTOPPER"] != "SS" || shortNames["THE LORD OF DJMAX"] != "LoD" {
		t.Error("shortNames")
	}
	for _, r := range RankOrder { // every rank has a threshold and a short name
		if _, ok := rankThresholds[r]; !ok {
			t.Errorf("no threshold for %s", r)
		}
		if _, ok := shortNames[r]; !ok {
			t.Errorf("no short name for %s", r)
		}
	}
}

func TestTheory(t *testing.T) {
	for _, c := range []struct {
		p    *int
		want bool
	}{{i(10000), true}, {i(10001), true}, {i(9999), false}, {nil, false}} {
		if got := IsTheoryPower(c.p); got != c.want {
			t.Errorf("IsTheoryPower(%v) = %v", intOrNil(c.p), got)
		}
	}
	for _, c := range []struct {
		v    *float64
		want bool
	}{{f(9999.9847), true}, {f(10000), true}, {f(9999.9846), false}, {f(9999.5), false}, {nil, false}} {
		if got := IsTheoryConversion(c.v); got != c.want {
			t.Errorf("IsTheoryConversion(%v) = %v", c.v, got)
		}
	}
}

func TestToPowerInteger(t *testing.T) {
	cases := []struct {
		in   *float64
		want any
	}{
		{f(9999.9847), 10000}, // theory bump
		{f(10000), 10000},
		{f(9999.9846), 9999}, // floor
		{f(9999.5), 9999},
		{f(8800.7), 8800},
		{f(0), 0}, // genuine zero preserved
		{nil, nil},
	}
	for _, c := range cases {
		if got := intOrNil(ToPowerInteger(c.in)); got != c.want {
			t.Errorf("ToPowerInteger(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestParseRankAndLevel(t *testing.T) {
	ranks := map[string]string{
		"SHOWSTOPPER II":    "SHOWSTOPPER",
		"4B SHOWSTOPPER II": "SHOWSTOPPER", // strips button prefix
		"THE LORD OF DJMAX": "THE LORD OF DJMAX",
		"":                  "BEGINNER",
		"rookie iv":         "rookie", // level match is case-insensitive
	}
	for in, want := range ranks {
		if got := ParseRankName(in); got != want {
			t.Errorf("ParseRankName(%q) = %q, want %q", in, got, want)
		}
	}
	levels := map[string]string{
		"SHOWSTOPPER II":    "II",
		"THE LORD OF DJMAX": "",
		"4B HEADLINER IV":   "IV",
		"rookie iv":         "IV",
		"":                  "",
	}
	for in, want := range levels {
		if got := ExtractLevel(in); got != want {
			t.Errorf("ExtractLevel(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestThreshold(t *testing.T) {
	cases := []struct {
		rank, level string
		want        any
	}{
		{"THE LORD OF DJMAX", "", 9980}, // default ignores level
		{"THE LORD OF DJMAX", "II", 9980},
		{"SHOWSTOPPER", "II", 9800},
		{"BEGINNER", "", 0},
		{"UNKNOWN RANK", "II", nil},
		{"SHOWSTOPPER", "", nil}, // rank needs a level
	}
	for _, c := range cases {
		if got := intOrNil(Threshold(c.rank, c.level)); got != c.want {
			t.Errorf("Threshold(%q, %q) = %v, want %v", c.rank, c.level, got, c.want)
		}
	}
}

func TestSortKey(t *testing.T) {
	cases := []struct {
		row  Row
		want [3]int
	}{
		{Row{4, "SHOWSTOPPER IV", f(9700)}, [3]int{11, 1, 0}},
		{Row{4, "THE LORD OF DJMAX", f(9999.9847)}, [3]int{13, 5, 0}}, // theory LoD = level 5
		{Row{4, "THE LORD OF DJMAX", f(9999.5)}, [3]int{13, 0, 0}},
		{Row{8, "ROOKIE I", f(4900)}, [3]int{3, 4, 3}},
		{Row{5, "ROOKIE I", f(4900)}, [3]int{3, 4, 2}},
		{Row{6, "ROOKIE I", f(4900)}, [3]int{3, 4, 1}},
		{Row{4, "ROOKIE I", f(4900)}, [3]int{3, 4, 0}},
		{Row{4, "NONSENSE II", f(100)}, [3]int{-1, 3, 0}},
	}
	for _, c := range cases {
		if got := SortKey(c.row); got != c.want {
			t.Errorf("SortKey(%+v) = %v, want %v", c.row, got, c.want)
		}
	}
}

func TestResolve(t *testing.T) {
	rows := []Row{{4, "SHOWSTOPPER II", f(9810)}, {8, "HEADLINER I", f(9660)}}
	check := func(name string, rows []Row, pref *int, sel Selection, wantButton int) {
		t.Helper()
		got, ok := Resolve(rows, pref, sel)
		if !ok || got.Button != wantButton {
			t.Errorf("%s: got %+v ok=%v, want button %d", name, got, ok, wantButton)
		}
	}
	check("auto picks highest class", rows, nil, Auto, 4)
	check("class beats raw power", []Row{{4, "SHOWSTOPPER II", f(9810)}, {8, "HEADLINER I", f(9999)}}, nil, Auto, 4)
	check("viewer prefers preferred", rows, i(8), Viewer, 8)
	check("auto ignores preference", rows, i(8), Auto, 4)
	check("viewer falls back when missing", rows, i(6), Viewer, 4)
	check("viewer falls back without preference", rows, nil, Viewer, 4)
	if _, ok := Resolve(nil, nil, Auto); ok {
		t.Error("empty rows resolved")
	}
	// Ties: first maximal row wins.
	tie := []Row{{8, "ROOKIE I", f(1)}, {8, "ROOKIE I", f(2)}}
	if got, _ := Resolve(tie, nil, Auto); *got.Conversion != 1 {
		t.Errorf("tie picked %+v, want the first", got)
	}
}

func TestBuildBadgeJSON(t *testing.T) {
	cases := []struct {
		row  Row
		want string
	}{
		{Row{4, "SHOWSTOPPER II", f(9810)},
			`{"button":4,"class":"SS II","rank":"SS","power":9810,"threshold":9800,"isTheory":false}`},
		{Row{8, "THE LORD OF DJMAX", f(9999.9847)},
			`{"button":8,"class":"LoD","rank":"LoD","power":10000,"threshold":9980,"isTheory":true}`},
		{Row{6, "MYSTERY RANK", nil},
			`{"button":6,"class":"MYSTERY RANK","rank":"MYSTERY RANK","power":null,"threshold":null,"isTheory":false}`},
	}
	for _, c := range cases {
		b, err := json.Marshal(BuildBadge(c.row))
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != c.want {
			t.Errorf("BuildBadge(%+v)\n got %s\nwant %s", c.row, b, c.want)
		}
	}
}

func TestValidPreferredButton(t *testing.T) {
	if !ValidPreferredButton(nil, []int{4, 8}) || !ValidPreferredButton(i(8), []int{4, 8}) {
		t.Error("valid choice rejected")
	}
	if ValidPreferredButton(i(5), []int{4, 8}) {
		t.Error("unavailable button accepted")
	}
}

// TestPythonGolden compares against outputs of the Django implementation over
// every rank/level x conversion (testdata/gen_golden.py regenerates the file).
func TestPythonGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/python_golden.json")
	if err != nil {
		t.Fatal(err)
	}
	type pyRow struct {
		Button     int      `json:"button"`
		Class      string   `json:"dj_class"`
		Conversion *float64 `json:"dj_power_conversion"`
	}
	var golden struct {
		Single []struct {
			Button     int             `json:"button"`
			Class      string          `json:"class"`
			Conversion *float64        `json:"conversion"`
			SortKey    [3]int          `json:"sortKey"`
			Badge      json.RawMessage `json:"badge"`
		} `json:"single"`
		Resolve []struct {
			Rows      []pyRow `json:"rows"`
			Preferred *int    `json:"preferred"`
			Sel       string  `json:"sel"`
			Index     int     `json:"index"`
		} `json:"resolve"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden.Single) == 0 || len(golden.Resolve) == 0 {
		t.Fatal("empty golden file")
	}
	for _, c := range golden.Single {
		r := Row{c.Button, c.Class, c.Conversion}
		if got := SortKey(r); got != c.SortKey {
			t.Errorf("SortKey(%+v) = %v, python %v", r, got, c.SortKey)
		}
		got, _ := json.Marshal(BuildBadge(r))
		var want, have any
		_ = json.Unmarshal(c.Badge, &want)
		_ = json.Unmarshal(got, &have)
		if !reflect.DeepEqual(have, want) {
			t.Errorf("BuildBadge(%+v)\n  go     %s\n  python %s", r, got, c.Badge)
		}
	}
	for _, c := range golden.Resolve {
		rows := make([]Row, len(c.Rows))
		for k, pr := range c.Rows {
			rows[k] = Row{pr.Button, pr.Class, pr.Conversion}
		}
		sel := Auto
		if c.Sel == "viewer" {
			sel = Viewer
		}
		got, _ := Resolve(rows, c.Preferred, sel)
		if want := rows[c.Index]; !reflect.DeepEqual(got, want) {
			t.Errorf("Resolve(%+v, %v, %s) = %+v, python picked #%d %+v", rows, intOrNil(c.Preferred), c.Sel, got, c.Index, want)
		}
	}
}

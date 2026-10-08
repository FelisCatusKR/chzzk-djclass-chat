package schedule

import (
	"testing"
	"time"
)

// Ported from overlay/tests/test_scheduler.py.
func TestUntil(t *testing.T) {
	cases := []struct {
		now  time.Time
		want time.Duration
	}{
		{time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC), 8 * time.Hour},
		{time.Date(2026, 6, 23, 17, 30, 0, 0, time.UTC), 30 * time.Minute},
		{time.Date(2026, 6, 23, 18, 0, 0, 0, time.UTC), 24 * time.Hour},
		{time.Date(2026, 6, 23, 19, 0, 0, 0, time.UTC), 23 * time.Hour},
		{time.Date(2026, 6, 30, 23, 0, 0, 0, time.UTC), 19 * time.Hour}, // month boundary
		// Non-UTC input (KST 03:00 = 18:00 UTC).
		{time.Date(2026, 6, 24, 3, 0, 0, 0, time.FixedZone("KST", 9*3600)), 24 * time.Hour},
	}
	for _, c := range cases {
		if got := Until(18, c.now); got != c.want {
			t.Errorf("Until(18, %s) = %s, want %s", c.now, got, c.want)
		}
	}
}

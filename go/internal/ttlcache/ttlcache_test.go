package ttlcache

import (
	"strconv"
	"sync"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func TestExpiry(t *testing.T) {
	clk := &clock{time.Unix(1000, 0)}
	c := New[string](10, clk.now)
	c.Set("a", "1", 10*time.Second)
	if v, ok := c.Get("a"); !ok || v != "1" {
		t.Fatalf("Get = %q %v", v, ok)
	}
	clk.t = clk.t.Add(9 * time.Second) // reading does not extend the TTL
	if _, ok := c.Get("a"); !ok {
		t.Fatal("expired early")
	}
	clk.t = clk.t.Add(time.Second) // exactly at expiry → gone
	if _, ok := c.Get("a"); ok {
		t.Fatal("not expired at TTL")
	}
	if c.Len() != 0 {
		t.Errorf("expired entry not removed, Len = %d", c.Len())
	}
}

func TestEvictsOldestInserted(t *testing.T) {
	c := New[int](2, nil)
	c.Set("a", 1, time.Hour)
	c.Set("b", 2, time.Hour)
	c.Set("a", 10, time.Hour) // overwrite keeps a's (oldest) position
	c.Set("c", 3, time.Hour)  // evicts a
	if _, ok := c.Get("a"); ok {
		t.Error("a should have been evicted")
	}
	for k, want := range map[string]int{"b": 2, "c": 3} {
		if v, ok := c.Get(k); !ok || v != want {
			t.Errorf("Get(%s) = %d %v", k, v, ok)
		}
	}
}

func TestDelete(t *testing.T) {
	c := New[int](2, nil)
	c.Set("a", 1, time.Hour)
	c.Delete("a")
	c.Delete("missing")
	if _, ok := c.Get("a"); ok || c.Len() != 0 {
		t.Error("Delete did not remove")
	}
}

func TestConcurrent(t *testing.T) {
	c := New[int](100, nil)
	var wg sync.WaitGroup
	for i := range 50 {
		wg.Go(func() {
			k := strconv.Itoa(i % 10)
			c.Set(k, i, time.Minute)
			c.Get(k)
			c.Delete(strconv.Itoa(i % 7))
		})
	}
	wg.Wait()
	if c.Len() > 10 {
		t.Errorf("Len = %d", c.Len())
	}
}

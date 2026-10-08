package ratelimit

import (
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestFixedWindowPerScopeAndIP(t *testing.T) {
	now := time.Unix(1000, 0)
	l := New(func() time.Time { return now })
	r := httptest.NewRequest("POST", "/", nil)
	r.Header.Set("CF-Connecting-IP", "1.1.1.1")
	for i := range 3 {
		if !l.Allow(r, "sync", 3, time.Minute) {
			t.Fatalf("request %d denied", i+1)
		}
	}
	if l.Allow(r, "sync", 3, time.Minute) {
		t.Fatal("4th request allowed")
	}
	if !l.Allow(r, "link", 3, time.Minute) {
		t.Error("other scope shares the bucket")
	}
	other := httptest.NewRequest("POST", "/", nil)
	other.Header.Set("CF-Connecting-IP", "2.2.2.2")
	if !l.Allow(other, "sync", 3, time.Minute) {
		t.Error("other IP shares the bucket")
	}
	now = now.Add(time.Minute)
	if !l.Allow(r, "sync", 3, time.Minute) {
		t.Error("window did not reset")
	}
}

func TestClientIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.1:5555"
	if got := ClientIP(r); got != "10.0.0.1" {
		t.Errorf("remote addr: %q", got)
	}
	r.Header.Set("X-Forwarded-For", " 3.3.3.3 , 10.0.0.2")
	if got := ClientIP(r); got != "3.3.3.3" {
		t.Errorf("xff: %q", got)
	}
	r.Header.Set("CF-Connecting-IP", "4.4.4.4")
	if got := ClientIP(r); got != "4.4.4.4" {
		t.Errorf("cf: %q", got)
	}
}

func TestBucketMapIsBounded(t *testing.T) {
	l := New(nil)
	r := httptest.NewRequest("POST", "/", nil)
	for i := range maxKeys + 50 { // all inside one window: none can be evicted as finished
		r.Header.Set("CF-Connecting-IP", strconv.Itoa(i))
		l.Allow(r, "link", 5, time.Hour)
	}
	if n := len(l.buckets); n > maxKeys+1 {
		t.Errorf("buckets = %d, want ≤ %d", n, maxKeys+1)
	}
}

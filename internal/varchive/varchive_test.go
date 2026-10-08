package varchive

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Ported from djclass_overlay/djclass/tests/test_varchive.py.

func newClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := New()
	c.BaseURL = srv.URL
	return c
}

func TestLookupUser(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		body    string
		want    User
		wantErr error
	}{
		{"ok", 200, `{"success":true,"userNo":4242,"nickname":"VA-Nick"}`, User{4242, "VA-Nick"}, nil},
		{"401", 401, ``, User{}, ErrInvalidToken},
		{"success false", 200, `{"success":false}`, User{}, ErrInvalidToken},
		{"missing fields", 200, `{"success":true}`, User{}, ErrInvalidToken},
		{"server error", 500, ``, User{}, ErrUnavailable},
		{"bad json", 200, `nope`, User{}, ErrUnavailable},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cl := newClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v2/open-token/user" || r.Header.Get("Authorization") != "Bearer SECRET-VA-TOKEN" {
					t.Errorf("%s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
				}
				w.WriteHeader(c.status)
				w.Write([]byte(c.body))
			})
			got, err := cl.LookupUser(context.Background(), "SECRET-VA-TOKEN")
			if !errors.Is(err, c.wantErr) || got != c.want {
				t.Errorf("got %+v, %v; want %+v, %v", got, err, c.want, c.wantErr)
			}
			if err != nil && strings.Contains(err.Error(), "SECRET-VA-TOKEN") {
				t.Errorf("error leaks token: %v", err)
			}
		})
	}
}

func TestLookupUserNetworkError(t *testing.T) {
	c := New()
	c.BaseURL = "http://127.0.0.1:1"
	if _, err := c.LookupUser(context.Background(), "tok"); !errors.Is(err, ErrUnavailable) {
		t.Errorf("err = %v", err)
	}
}

func TestAllDjClassesSkipsFailures(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("public endpoint got a token")
		}
		switch r.URL.EscapedPath() {
		case "/api/v2/archive/VA%20Nick%2F%ED%95%9C/djClass/4":
			w.Write([]byte(`{"success":true,"djClass":"SHOWSTOPPER II","djPowerSum":1.0,"maxDjPower":2.0,"djPowerConversion":9823.0}`))
		case "/api/v2/archive/VA%20Nick%2F%ED%95%9C/djClass/8":
			w.Write([]byte(`{"success":true,"djClass":"HEADLINER IV","djPowerConversion":9410.0}`))
		case "/api/v2/archive/VA%20Nick%2F%ED%95%9C/djClass/6":
			w.Write([]byte(`{"success":true,"djClass":""}`)) // no class
		default:
			http.NotFound(w, r) // 5 (and anything mis-escaped)
		}
	})
	rows := c.AllDjClasses(context.Background(), "VA Nick/한")
	if len(rows) != 2 || rows[0].Button != 4 || rows[1].Button != 8 {
		t.Fatalf("rows = %+v", rows)
	}
	if rows[0].Class != "SHOWSTOPPER II" || *rows[0].PowerConversion != 9823 || rows[1].PowerSum != nil {
		t.Errorf("rows = %+v", rows)
	}
}

func TestConcurrencyIsCapped(t *testing.T) {
	var inFlight, peak atomic.Int64
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		n := inFlight.Add(1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		inFlight.Add(-1)
		http.NotFound(w, r)
	})
	done := make(chan struct{})
	for range 5 { // 5 users × 4 buttons = 20 requests
		go func() { c.AllDjClasses(context.Background(), "n"); done <- struct{}{} }()
	}
	for range 5 {
		<-done
	}
	if p := peak.Load(); p > maxInFlight {
		t.Errorf("peak in-flight %d > cap %d", p, maxInFlight)
	}
}

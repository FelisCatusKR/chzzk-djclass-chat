// Package ratelimit is an in-memory, per-client-IP fixed-window limiter (port
// of common/ratelimit.py). Single process only, like the rest of the app.
package ratelimit

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const maxKeys = 10000

type key struct{ scope, ip string }

type bucket struct {
	start  time.Time
	count  int
	window time.Duration
}

type Limiter struct {
	mu      sync.Mutex
	buckets map[key]*bucket
	now     func() time.Time
}

// New returns a limiter; now is injectable for tests (nil = time.Now).
func New(now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{buckets: map[key]*bucket{}, now: now}
}

// Allow reports whether this (scope, client IP) is within limit requests per
// window, counting the request when it is.
func (l *Limiter) Allow(r *http.Request, scope string, limit int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	t := l.now()
	if len(l.buckets) > maxKeys { // opportunistic eviction of finished windows
		for k, b := range l.buckets {
			if t.Sub(b.start) >= b.window {
				delete(l.buckets, k)
			}
		}
		if len(l.buckets) > maxKeys { // still full within one window: hard bound on memory
			clear(l.buckets)
		}
	}
	k := key{scope, ClientIP(r)}
	b, ok := l.buckets[k]
	if !ok || t.Sub(b.start) >= window {
		l.buckets[k] = &bucket{start: t, count: 1, window: window}
		return true
	}
	if b.count >= limit {
		return false
	}
	b.count++
	return true
}

// ClientIP is the real client address. Trusting CF-Connecting-IP is safe only
// because the app is reachable solely through the Cloudflare Tunnel: in
// homelab-infra the web container publishes no port and only cloudflared
// shares its Podman network, and the router forwards nothing but WireGuard.
// If that ever changes, these headers become client-controlled.
func ClientIP(r *http.Request) string {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first, _, _ := strings.Cut(xff, ",")
		return strings.TrimSpace(first)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

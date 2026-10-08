package web

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

// csp mirrors the Django SECURE_CSP policy. Alpine needs 'unsafe-eval' and
// @tailwindcss/browser injects <style> ('unsafe-inline' for styles only); no
// inline scripts anywhere. img-src MUST keep Naver's emoji CDN or chat emoji
// break; pages.dev hosts the cover image.
const csp = "default-src 'self'; " +
	"script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; " +
	"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
	"img-src 'self' https://chzzk-djclass-assets.pages.dev https://*.pstatic.net https://*.naver.net data:; " +
	"font-src https://cdn.jsdelivr.net; " +
	"connect-src 'self'; " +
	"frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func securityHeaders(https bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		if https {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

// accessLog records method, path (never the query: it can carry OAuth codes),
// status, whether a session cookie came with the request, and duration.
func accessLog(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		_, cookieErr := r.Cookie("session")
		log.Info("http", "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"session_cookie", cookieErr == nil, "dur", time.Since(start).Round(time.Millisecond))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController reach Flush/SetWriteDeadline (SSE).
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

const sessionUserID = "userID"

type userKey struct{}

// withUser loads/saves the session and puts the logged-in user (if any) in
// the request context.
func (s *Server) withUser(h http.HandlerFunc) http.Handler {
	return s.Sessions.LoadAndSave(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := s.Sessions.GetInt64(r.Context(), sessionUserID); id != 0 {
			u, err := s.Store.Read.GetUserByID(r.Context(), id)
			switch {
			case err == nil:
				r = r.WithContext(context.WithValue(r.Context(), userKey{}, &u))
			case errors.Is(err, sql.ErrNoRows): // user deleted: drop the stale session
				_ = s.Sessions.Destroy(r.Context())
			default:
				s.Log.Error("load session user", "err", err)
				http.Error(w, "서버 오류", http.StatusInternalServerError)
				return
			}
		}
		h(w, r)
	}))
}

func currentUser(r *http.Request) *db.User {
	u, _ := r.Context().Value(userKey{}).(*db.User)
	return u
}

// requireLogin sends anonymous users to /login/?next=<path>. htmx requests
// get HX-Redirect instead of a 302, which htmx would follow via XHR and swap
// the login page into the current fragment.
func (s *Server) requireLogin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if currentUser(r) != nil {
			h(w, r)
			return
		}
		// Return to the requested page — except for htmx fragment requests
		// (e.g. a button's hx-post), where that is the page the user is on.
		// Boosted links are navigations, so they keep the requested path.
		next := r.URL.Path
		if r.Header.Get("HX-Request") == "true" && r.Header.Get("HX-Boosted") != "true" {
			if cur, err := url.Parse(r.Header.Get("HX-Current-URL")); err == nil && cur.Path != "" {
				next = cur.Path
			}
		}
		target := "/login/?next=" + url.QueryEscape(next)
		if r.Header.Get("HX-Request") == "true" {
			w.Header().Set("HX-Redirect", target)
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Redirect(w, r, target, http.StatusFound)
	}
}

// safeNextPath accepts only same-origin relative paths (port of
// common/safe_redirect.py): no absolute, protocol-relative or backslash URLs.
// Unlike the Python version it also rejects control characters, which
// browsers strip from URLs ("/\t/evil.example" would become "//evil.example").
func safeNextPath(next, fallback string) string {
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, `/\`) {
		return fallback
	}
	for _, c := range next {
		if c < 0x20 || c == 0x7f {
			return fallback
		}
	}
	return next
}

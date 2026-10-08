// Package web is the HTTP layer: config pages (landing, login, dashboard),
// Chzzk OAuth login with server-side sessions, the OBS widget page and its SSE
// stream, static assets, and (dev mode only) a chat-injection page.
package web

import (
	"embed"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/alexedwards/scs/v2"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/link"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/ratelimit"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/realtime"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
)

//go:embed templates
var templateFS embed.FS

// standalone templates (no shared layout)
var templates = template.Must(template.ParseFS(templateFS, "templates/*.html"))

// pages share templates/base.html; each defines "title" and "content".
var pages = func() map[string]*template.Template {
	m := map[string]*template.Template{}
	names, _ := fs.Glob(templateFS, "templates/pages/*.html")
	for _, n := range names {
		m[strings.TrimPrefix(n, "templates/pages/")] = template.Must(template.ParseFS(templateFS, "templates/base.html", n))
	}
	return m
}()

type Server struct {
	Hub      *realtime.Hub
	Store    *store.Store
	Chzzk    *chzzk.Client
	Box      *crypto.Box
	Sessions *scs.SessionManager
	Limiter  *ratelimit.Limiter
	Link     *link.Service
	BaseURL  string // public origin, no trailing slash
	HTTPS    bool   // BaseURL is https: Secure cookies, HSTS
	Log      *slog.Logger

	// Static assets: css/chat.css, js/components.js, overlay/widget.js.
	Static fs.FS

	// Dev enables /dev (chat injection). Never in production.
	Dev bool
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Config pages: sessions + current user.
	page := func(pattern string, h http.HandlerFunc) { mux.Handle(pattern, s.withUser(h)) }
	page("GET /{$}", s.landing)
	page("GET /login/{$}", s.loginPage)
	page("GET /api/auth/chzzk", s.startLogin)
	page("GET /api/auth/chzzk/callback", s.callback)
	page("POST /logout/{$}", s.logout)
	page("GET /dashboard/{$}", s.requireLogin(s.dashboard))
	page("GET /link/{$}", s.requireLogin(s.linkPage))
	page("POST /link/connect/{$}", s.requireLogin(s.linkConnect))
	page("POST /link/sync/{$}", s.requireLogin(s.linkSync))
	page("POST /link/unlink/{$}", s.requireLogin(s.linkUnlink))
	page("POST /link/preferred-button/{$}", s.requireLogin(s.linkPreferredButton))
	for _, p := range []string{"/login", "/dashboard", "/link"} { // Django APPEND_SLASH parity
		mux.Handle("GET "+p, http.RedirectHandler(p+"/", http.StatusMovedPermanently))
	}

	// Widget + assets: no session lookup (OBS has no cookies; SSE is long-lived).
	mux.HandleFunc("GET /widget/{channelID}", s.widgetPage)
	mux.HandleFunc("GET /widget/{channelID}/{$}", s.widgetPage)
	mux.HandleFunc("GET /widget/{channelID}/stream", s.widgetStream)
	mux.Handle("GET /static/", http.StripPrefix("/static/", noDirListing(http.FileServerFS(s.Static))))
	mux.HandleFunc("GET /healthz", s.healthz)

	if s.Dev {
		page("GET /dev", s.devPage)
		page("POST /dev/chat", s.devChat)
	}

	csrf := http.NewCrossOriginProtection()
	csrf.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Log.Warn("cross-origin request blocked", "method", r.Method, "path", r.URL.Path)
		http.Error(w, "다른 사이트에서 보낸 요청은 처리할 수 없습니다.", http.StatusForbidden)
	}))
	return accessLog(s.Log, securityHeaders(s.HTTPS, csrf.Handler(mux)))
}

func (s *Server) renderPage(w http.ResponseWriter, status int, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := pages[name].ExecuteTemplate(w, "base", data); err != nil {
		s.Log.Error("render page", "page", name, "err", err)
	}
}

func (s *Server) render(w http.ResponseWriter, status int, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := templates.ExecuteTemplate(w, name, data); err != nil {
		s.Log.Error("render template", "template", name, "err", err)
	}
}

// healthz is the container health check: the process serves HTTP and the
// database answers.
func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.ReadDB().PingContext(r.Context()); err != nil {
		http.Error(w, "db unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ok"))
}

func noDirListing(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") || r.URL.Path == "" {
			http.NotFound(w, r)
			return
		}
		h.ServeHTTP(w, r)
	})
}

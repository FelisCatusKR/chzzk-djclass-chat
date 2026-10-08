// Package web is the HTTP layer: the OBS widget page and its SSE stream,
// Chzzk OAuth login, static assets, and (dev mode only) a chat-injection page.
package web

import (
	"embed"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/realtime"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
)

//go:embed templates/*.html
var templateFS embed.FS

var templates = template.Must(template.ParseFS(templateFS, "templates/*.html"))

type Server struct {
	Hub     *realtime.Hub
	Store   *store.Store
	Chzzk   *chzzk.Client
	Box     *crypto.Box
	BaseURL string // public origin, no trailing slash
	Log     *slog.Logger

	// Static assets: css/chat.css and overlay/widget.js.
	Static fs.FS

	// Dev enables /dev (chat injection). Never in production.
	Dev bool
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.home)
	mux.HandleFunc("GET /widget/{channelID}", s.widgetPage)
	mux.HandleFunc("GET /widget/{channelID}/{$}", s.widgetPage)
	mux.HandleFunc("GET /widget/{channelID}/stream", s.widgetStream)
	mux.HandleFunc("GET /login", s.login)
	mux.HandleFunc("GET /api/auth/chzzk/callback", s.callback)
	mux.Handle("GET /static/", http.StripPrefix("/static/", noDirListing(http.FileServerFS(s.Static))))
	if s.Dev {
		mux.HandleFunc("GET /dev", s.devPage)
		mux.HandleFunc("POST /dev/chat", s.devChat)
	}
	return mux
}

func (s *Server) render(w http.ResponseWriter, status int, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := templates.ExecuteTemplate(w, name, data); err != nil {
		s.Log.Error("render template", "template", name, "err", err)
	}
}

// home is a placeholder until the landing page / dashboard arrive.
func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	msg := message{Title: "DJ CLASS 채팅 오버레이", Lines: []string{"치지직으로 로그인하면 OBS 위젯 주소를 받을 수 있습니다."}, LoginURL: "/login"}
	if s.Dev {
		msg.DevURL = "/dev"
	}
	s.render(w, http.StatusOK, "message.html", msg)
}

type message struct {
	Title     string
	Lines     []string
	WidgetURL string
	DevURL    string
	LoginURL  string
}

func (s *Server) renderMessage(w http.ResponseWriter, status int, title string, lines ...string) {
	s.render(w, status, "message.html", message{Title: title, Lines: lines})
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

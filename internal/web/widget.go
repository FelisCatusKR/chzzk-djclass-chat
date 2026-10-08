package web

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/realtime"
)

const (
	keepaliveInterval = 15 * time.Second
	// writeTimeout bounds every SSE write: a client that stops reading (or a
	// deliberate slow-reader) is dropped instead of pinning a goroutine forever.
	writeTimeout = 10 * time.Second
)

// widgetPage serves the OBS browser-source page. The channel id rides on a
// data attribute (no inline script), as in the Django template.
func (s *Server) widgetPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", widgetCSP)
	s.render(w, http.StatusOK, "widget.html", struct{ ChannelID string }{r.PathValue("channelID")})
}

// widgetStream is the SSE endpoint the widget subscribes to. Only channels of
// streamers who have logged in get a worker; anything else is 404, so random
// ids can't spin up Chzzk connections.
func (s *Server) widgetStream(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("channelID")
	if _, err := s.Store.Read.GetChannelByChzzkID(r.Context(), channelID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.NotFound(w, r)
		} else {
			s.Log.Error("widget stream: channel lookup", "err", err)
			http.Error(w, "서버 오류", http.StatusInternalServerError)
		}
		return
	}

	sub, err := s.Hub.Subscribe(channelID)
	if errors.Is(err, realtime.ErrTooManySubscribers) {
		s.Log.Warn("widget stream: subscriber cap reached", "channel", channelID)
		http.Error(w, "위젯 연결이 너무 많습니다.", http.StatusServiceUnavailable)
		return
	}
	if err != nil {
		http.Error(w, "서버가 종료 중입니다", http.StatusServiceUnavailable)
		return
	}
	defer s.Hub.Unsubscribe(sub)

	rc := http.NewResponseController(w)
	// The stream outlives the server's WriteTimeout: a short write deadline is
	// re-armed before every write instead. (ReadTimeout does not end a running
	// handler; TestStreamOutlivesReadTimeoutAndIsCapped guards that.)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	send := func(chunk string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(writeTimeout))
		if _, err := fmt.Fprint(w, chunk); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	if !send(": connected\n\n") {
		return
	}

	keepalive := time.NewTicker(keepaliveInterval)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case data, ok := <-sub.C:
			if !ok { // hub shut down
				return
			}
			if !send("event: chat\ndata: " + string(data) + "\n\n") {
				return
			}
		case <-keepalive.C:
			if !send(": keepalive\n\n") { // survive proxy idle timeouts
				return
			}
		}
	}
}

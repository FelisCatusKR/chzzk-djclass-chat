package web

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const keepaliveInterval = 15 * time.Second

// widgetPage serves the OBS browser-source page. The channel id rides on a
// data attribute (no inline script), as in the Django template.
func (s *Server) widgetPage(w http.ResponseWriter, r *http.Request) {
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
	if err != nil {
		http.Error(w, "서버가 종료 중입니다", http.StatusServiceUnavailable)
		return
	}
	defer s.Hub.Unsubscribe(sub)

	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{}) // the stream outlives the server's WriteTimeout
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	send := func(chunk string) bool {
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

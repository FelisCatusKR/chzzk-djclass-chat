package web

import (
	"database/sql"
	"errors"
	"net/http"
)

func (s *Server) landing(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, http.StatusOK, "landing.html", nil)
}

// loginContext explains why login is needed, keyed by the ?next target.
var loginContext = map[string]string{
	"/dashboard/": "위젯 설정을 위해",
	"/link/":      "DJ CLASS 연동을 위해",
}

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	if currentUser(r) != nil {
		http.Redirect(w, r, "/dashboard/", http.StatusFound)
		return
	}
	next := r.URL.Query().Get("next")
	s.renderPage(w, http.StatusOK, "login.html", struct{ Next, Context string }{
		Next: safeNextPath(next, "/dashboard/"), Context: loginContext[next],
	})
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	data := struct {
		WidgetBaseURL, ChannelID string
		Dev                      bool
	}{Dev: s.Dev}
	ch, err := s.Store.Read.GetChannelByChzzkID(r.Context(), u.ChzzkID)
	switch {
	case err == nil:
		data.ChannelID = ch.ChzzkChannelID
		data.WidgetBaseURL = s.BaseURL + "/widget/" + ch.ChzzkChannelID + "/"
	case !errors.Is(err, sql.ErrNoRows):
		s.Log.Error("dashboard: channel lookup", "err", err)
		http.Error(w, "서버 오류", http.StatusInternalServerError)
		return
	}
	s.renderPage(w, http.StatusOK, "dashboard.html", data)
}

package web

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/link"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/varchive"
)

const msgTooMany = "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."

type cardView struct {
	link.Card
	Message, MessageType string
}

func (s *Server) linkPage(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	card, err := s.Link.Card(r.Context(), *u)
	if err != nil {
		s.Log.Error("link page", "err", err)
		http.Error(w, "서버 오류", http.StatusInternalServerError)
		return
	}
	s.renderPage(w, http.StatusOK, "link.html", struct {
		User any
		Card cardView
	}{u, cardView{Card: card}})
}

// tooMany answers a rate-limited card action: 429 (as AGENTS.md promises),
// with the card body so htmx (configured in base.html) still shows the message.
func (s *Server) tooMany(w http.ResponseWriter, r *http.Request) {
	s.renderCardStatus(w, r, http.StatusTooManyRequests, msgTooMany, "error")
}

// renderCard answers an hx-post with just the #link-card fragment. It re-reads
// the user: the action may have just changed it (e.g. the preferred button),
// and the request-scoped user was loaded before that.
func (s *Server) renderCard(w http.ResponseWriter, r *http.Request, msg, msgType string) {
	s.renderCardStatus(w, r, http.StatusOK, msg, msgType)
}

func (s *Server) renderCardStatus(w http.ResponseWriter, r *http.Request, status int, msg, msgType string) {
	u, err := s.Store.Read.GetUserByID(r.Context(), currentUser(r).ID)
	if err != nil {
		s.Log.Error("link card: reload user", "err", err)
		http.Error(w, "서버 오류", http.StatusInternalServerError)
		return
	}
	card, err := s.Link.Card(r.Context(), u)
	if err != nil {
		s.Log.Error("link card", "err", err)
		http.Error(w, "서버 오류", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := pages["link.html"].ExecuteTemplate(w, "link_card", cardView{card, msg, msgType}); err != nil {
		s.Log.Error("render link card", "err", err)
	}
}

func (s *Server) linkConnect(w http.ResponseWriter, r *http.Request) {
	if !s.Limiter.Allow(r, "link", 5, time.Minute) {
		s.tooMany(w, r)
		return
	}
	token := strings.TrimSpace(r.FormValue("token"))
	if token == "" {
		s.renderCard(w, r, "조회토큰을 입력하세요.", "error")
		return
	}
	_, err := s.Link.Connect(r.Context(), *currentUser(r), token)
	switch {
	case errors.Is(err, varchive.ErrInvalidToken):
		s.renderCard(w, r, "조회토큰이 유효하지 않습니다. 다시 확인해주세요.", "error")
	case errors.Is(err, varchive.ErrUnavailable):
		s.renderCard(w, r, "네트워크 오류가 발생했습니다.", "error")
	case err != nil:
		s.Log.Error("link connect", "err", err)
		s.renderCard(w, r, "연동 중 오류가 발생했습니다.", "error")
	default: // an empty first sync is fine: no badges yet
		s.renderCard(w, r, "연동 완료! 이제 채팅에서 DJ CLASS가 표시됩니다.", "success")
	}
}

func (s *Server) linkSync(w http.ResponseWriter, r *http.Request) {
	if !s.Limiter.Allow(r, "sync", 3, time.Minute) {
		s.tooMany(w, r)
		return
	}
	res, err := s.Link.Sync(r.Context(), *currentUser(r))
	switch {
	case errors.Is(err, link.ErrNotLinked):
		s.renderCard(w, r, "먼저 V-ARCHIVE를 연동해주세요.", "error")
	case err != nil:
		s.Log.Error("link sync", "err", err)
		s.renderCard(w, r, "동기화 중 오류가 발생했습니다.", "error")
	case !res.OK && res.Stale: // had rows, fetch empty: nickname probably changed
		s.renderCard(w, r, "DJ CLASS 정보를 찾을 수 없습니다. V-ARCHIVE 닉네임이 바뀌었다면 다시 연동해주세요.", "error")
	case !res.OK:
		s.renderCard(w, r, "동기화할 DJ CLASS 정보가 없습니다.", "error")
	default:
		s.renderCard(w, r, fmt.Sprintf("DJ CLASS 동기화 완료: %dB %s", res.Highest.Button, res.Highest.Class), "success")
	}
}

func (s *Server) linkUnlink(w http.ResponseWriter, r *http.Request) {
	if err := s.Link.Unlink(r.Context(), *currentUser(r)); err != nil {
		s.Log.Error("link unlink", "err", err)
		s.renderCard(w, r, "연동 해제 중 오류가 발생했습니다.", "error")
		return
	}
	s.renderCard(w, r, "V-ARCHIVE 연동을 해제했습니다.", "success")
}

func (s *Server) linkPreferredButton(w http.ResponseWriter, r *http.Request) {
	if !s.Limiter.Allow(r, "pref", 10, time.Minute) {
		s.tooMany(w, r)
		return
	}
	err := s.Link.SetPreferredButton(r.Context(), *currentUser(r), r.FormValue("button"))
	switch {
	case errors.Is(err, link.ErrInvalidButton):
		s.renderCard(w, r, "잘못된 버튼 선택입니다.", "error")
	case err != nil:
		s.Log.Error("link preferred button", "err", err)
		s.renderCard(w, r, "저장 중 오류가 발생했습니다.", "error")
	default:
		s.renderCard(w, r, "", "")
	}
}

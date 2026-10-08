package web

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

// The OAuth state lives in a short-lived cookie scoped to the callback path,
// not in a server session: visiting /login creates no DB rows.
const stateCookie = "oauth_state"

// login redirects to Chzzk's consent page. Minimal for now: sessions and the
// dashboard come with the web stage.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	state := hex.EncodeToString(b)
	http.SetCookie(w, &http.Cookie{
		Name:     stateCookie,
		Value:    state,
		Path:     "/api/auth/chzzk/",
		MaxAge:   300,
		HttpOnly: true,
		Secure:   strings.HasPrefix(s.BaseURL, "https://"),
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, s.Chzzk.AuthorizeURL(state), http.StatusFound)
}

// callback exchanges the code, then stores the user and the encrypted Chzzk
// tokens the channel worker needs.
func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	code, state := r.URL.Query().Get("code"), r.URL.Query().Get("state")
	c, err := r.Cookie(stateCookie)
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Path: "/api/auth/chzzk/", MaxAge: -1})
	if err != nil || code == "" || state == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		s.Log.Warn("oauth: state mismatch or missing parameters")
		s.renderMessage(w, http.StatusBadRequest, "로그인 실패", "로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해주세요.")
		return
	}

	ctx := r.Context()
	tok, err := s.Chzzk.ExchangeCode(ctx, code, state)
	if err != nil {
		s.Log.Error("oauth: token exchange", "err", err)
		s.renderMessage(w, http.StatusBadGateway, "로그인 실패", "치지직 인증 서버와 통신하지 못했습니다. 잠시 후 다시 시도해주세요.")
		return
	}
	me, err := s.Chzzk.Me(ctx, tok.AccessToken)
	if err != nil {
		s.Log.Error("oauth: users/me", "err", err)
		s.renderMessage(w, http.StatusBadGateway, "로그인 실패", "치지직 사용자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.")
		return
	}

	access, refresh := s.Box.Encrypt(tok.AccessToken), s.Box.Encrypt(tok.RefreshToken)
	expires := time.Now().Unix() + int64(tok.ExpiresIn)
	err = s.Store.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		u, err := q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: me.ChannelID, ChzzkNickname: me.Nickname})
		if err != nil {
			return err
		}
		return q.UpsertChannel(ctx, db.UpsertChannelParams{
			UserID: u.ID, ChzzkChannelID: me.ChannelID,
			AccessTokenEncrypted: &access, RefreshTokenEncrypted: &refresh, TokenExpiresAt: &expires,
		})
	})
	if err != nil {
		s.Log.Error("oauth: save user", "err", err)
		s.renderMessage(w, http.StatusInternalServerError, "로그인 실패", "로그인 정보를 저장하지 못했습니다.")
		return
	}
	s.Log.Info("oauth: logged in", "channel", me.ChannelID)

	msg := message{
		Title:     "로그인 완료",
		Lines:     []string{me.Nickname + "님, 로그인되었습니다. 아래 주소를 OBS 브라우저 소스로 추가하세요."},
		WidgetURL: s.BaseURL + "/widget/" + me.ChannelID + "/",
	}
	if s.Dev {
		msg.DevURL = "/dev?channel=" + me.ChannelID
	}
	s.render(w, http.StatusOK, "message.html", msg)
}

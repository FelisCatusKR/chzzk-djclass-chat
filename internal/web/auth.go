package web

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

// The OAuth state and the post-login target live in short-lived cookies
// scoped to the callback path, not in the session: visiting the login link
// writes nothing to the DB.
const (
	stateCookie = "oauth_state"
	nextCookie  = "oauth_next"
	oauthPath   = "/api/auth/chzzk/"
)

func (s *Server) oauthCookie(name, value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name: name, Value: value, Path: oauthPath, MaxAge: maxAge,
		HttpOnly: true, Secure: s.HTTPS, SameSite: http.SameSiteLaxMode,
	}
}

// startLogin redirects to Chzzk's consent page (Django: chzzk_login).
func (s *Server) startLogin(w http.ResponseWriter, r *http.Request) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	state := hex.EncodeToString(b)
	http.SetCookie(w, s.oauthCookie(stateCookie, state, 300))
	http.SetCookie(w, s.oauthCookie(nextCookie, safeNextPath(r.URL.Query().Get("next"), "/dashboard/"), 300))
	http.Redirect(w, r, s.Chzzk.AuthorizeURL(state), http.StatusFound)
}

// callback exchanges the code, stores the user and the encrypted Chzzk tokens
// the channel worker needs, and logs the user in (Django: chzzk_callback).
// Any failure lands on "/?error=auth_failed", as before.
func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	fail := func() { http.Redirect(w, r, "/?error=auth_failed", http.StatusFound) }
	if !s.Limiter.Allow(r, "auth", 10, time.Minute) {
		http.Error(w, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", http.StatusTooManyRequests)
		return
	}
	code, state := r.URL.Query().Get("code"), r.URL.Query().Get("state")
	stored, err := r.Cookie(stateCookie)
	next := "/dashboard/"
	if c, err := r.Cookie(nextCookie); err == nil {
		next = safeNextPath(c.Value, next)
	}
	http.SetCookie(w, s.oauthCookie(stateCookie, "", -1))
	http.SetCookie(w, s.oauthCookie(nextCookie, "", -1))
	if err != nil || code == "" || state == "" || subtle.ConstantTimeCompare([]byte(stored.Value), []byte(state)) != 1 {
		s.Log.Warn("oauth: state mismatch or missing parameters")
		fail()
		return
	}

	ctx := r.Context()
	tok, err := s.Chzzk.ExchangeCode(ctx, code, state)
	if err != nil {
		s.Log.Error("oauth: token exchange", "err", err)
		fail()
		return
	}
	me, err := s.Chzzk.Me(ctx, tok.AccessToken)
	if err != nil {
		s.Log.Error("oauth: users/me", "err", err)
		fail()
		return
	}

	access, refresh := s.Box.Encrypt(tok.AccessToken), s.Box.Encrypt(tok.RefreshToken)
	expires := time.Now().Unix() + int64(tok.ExpiresIn)
	var user db.User
	err = s.Store.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		var err error
		if user, err = q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: me.ChannelID, ChzzkNickname: me.Nickname}); err != nil {
			return err
		}
		return q.UpsertChannel(ctx, db.UpsertChannelParams{
			UserID: user.ID, ChzzkChannelID: me.ChannelID,
			AccessTokenEncrypted: &access, RefreshTokenEncrypted: &refresh, TokenExpiresAt: &expires,
		})
	})
	if err != nil {
		s.Log.Error("oauth: save user", "err", err)
		fail()
		return
	}

	// New session token on login (no session fixation), then store the user.
	if err := s.Sessions.RenewToken(ctx); err != nil {
		s.Log.Error("oauth: renew session", "err", err)
		fail()
		return
	}
	s.Sessions.Put(ctx, sessionUserID, user.ID)
	s.Log.Info("oauth: logged in", "user", user.ID)
	http.Redirect(w, r, next, http.StatusFound)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if err := s.Sessions.Destroy(r.Context()); err != nil {
		s.Log.Error("logout", "err", err)
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

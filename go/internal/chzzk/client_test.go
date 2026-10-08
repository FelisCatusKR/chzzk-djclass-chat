package chzzk

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func newTestClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := New("CID", "CSECRET", "http://localhost:8000/api/auth/chzzk/callback")
	c.TokenURL = srv.URL + "/auth/v1/token"
	c.APIURL = srv.URL + "/open/v1"
	return c
}

func TestAuthorizeURL(t *testing.T) {
	c := New("CID", "S", "http://localhost:8000/api/auth/chzzk/callback")
	u, err := url.Parse(c.AuthorizeURL("st8"))
	if err != nil {
		t.Fatal(err)
	}
	if got := u.Scheme + "://" + u.Host + u.Path; got != AuthURL {
		t.Errorf("base = %q", got)
	}
	q := u.Query()
	if q.Get("clientId") != "CID" || q.Get("state") != "st8" ||
		q.Get("redirectUri") != "http://localhost:8000/api/auth/chzzk/callback" {
		t.Errorf("query = %v", q)
	}
}

func TestExchangeCode(t *testing.T) {
	var body map[string]string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/auth/v1/token" {
			t.Errorf("%s %s", r.Method, r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("content-type = %q", ct)
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = w.Write([]byte(`{"code":200,"content":{"accessToken":"AT","refreshToken":"RT","expiresIn":"3600"}}`))
	})
	tok, err := c.ExchangeCode(context.Background(), "CODE", "STATE")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"grantType": "authorization_code", "clientId": "CID", "clientSecret": "CSECRET", "code": "CODE", "state": "STATE"}
	for k, v := range want {
		if body[k] != v {
			t.Errorf("body[%s] = %q, want %q", k, body[k], v)
		}
	}
	if tok != (Token{AccessToken: "AT", RefreshToken: "RT", ExpiresIn: 3600}) {
		t.Errorf("token = %+v", tok)
	}
}

func TestRefreshUnwrappedAndDefaultExpiry(t *testing.T) {
	var body map[string]string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = w.Write([]byte(`{"accessToken":"AT2","refreshToken":"RT2"}`))
	})
	tok, err := c.Refresh(context.Background(), "RT")
	if err != nil {
		t.Fatal(err)
	}
	if body["grantType"] != "refresh_token" || body["refreshToken"] != "RT" {
		t.Errorf("body = %v", body)
	}
	if tok.AccessToken != "AT2" || tok.ExpiresIn != 86400 {
		t.Errorf("token = %+v", tok)
	}
}

func TestMe(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/open/v1/users/me" || r.Header.Get("Authorization") != "Bearer AT" {
			t.Errorf("%s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"content":{"channelId":"ch1","channelName":"닉네임"}}`))
	})
	me, err := c.Me(context.Background(), "AT")
	if err != nil {
		t.Fatal(err)
	}
	if me != (User{ChannelID: "ch1", Nickname: "닉네임"}) {
		t.Errorf("me = %+v", me)
	}
}

func TestUserSessionURL(t *testing.T) {
	cases := []struct{ returned, want string }{
		{"wss://ssio.chzzk.naver.com/abc", "wss://ssio.chzzk.naver.com/abc?auth=TOK"},
		{"wss://host/x?foo=1", "wss://host/x?foo=1&auth=TOK"},
		{"wss://host/x?auth=already", "wss://host/x?auth=already"},
	}
	for _, tc := range cases {
		c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/open/v1/sessions/auth" || r.Header.Get("Authorization") != "Bearer TOK" {
				t.Errorf("%s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"content": map[string]string{"url": tc.returned}})
		})
		got, err := c.UserSessionURL(context.Background(), "TOK")
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Errorf("UserSessionURL(%q) = %q, want %q", tc.returned, got, tc.want)
		}
	}
}

func TestSubscribeChat(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/open/v1/sessions/events/subscribe/chat" ||
			r.URL.Query().Get("sessionKey") != "KEY1" || r.Header.Get("Authorization") != "Bearer TOK" {
			t.Errorf("%s %s auth=%q", r.Method, r.URL, r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{}`))
	})
	if err := c.SubscribeChat(context.Background(), "TOK", "KEY1"); err != nil {
		t.Fatal(err)
	}
}

func TestErrorsDoNotLeakSecrets(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"message":"bad SECRETBODY"}`, http.StatusUnauthorized)
	})
	err := c.SubscribeChat(context.Background(), "SECRETTOKEN", "SECRETKEY")
	if err == nil {
		t.Fatal("want error")
	}
	for _, s := range []string{"SECRETTOKEN", "SECRETKEY", "SECRETBODY"} {
		if strings.Contains(err.Error(), s) {
			t.Errorf("error leaks %s: %v", s, err)
		}
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error lacks status: %v", err)
	}
}

func TestNetworkErrorsDoNotLeakQuery(t *testing.T) {
	c := New("CID", "S", "")
	c.APIURL = "http://127.0.0.1:1/open/v1" // nothing listens: connection refused
	err := c.SubscribeChat(context.Background(), "SECRETTOKEN", "SECRETKEY")
	if err == nil {
		t.Fatal("want error")
	}
	if strings.Contains(err.Error(), "SECRETKEY") || strings.Contains(err.Error(), "SECRETTOKEN") {
		t.Errorf("error leaks secrets: %v", err)
	}
}

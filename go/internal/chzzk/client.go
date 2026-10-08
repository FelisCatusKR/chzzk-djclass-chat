// Package chzzk is the Chzzk Open API client: OAuth (authorize URL, code
// exchange, refresh), the current user, and the realtime session endpoints.
// Port of djclass_overlay/common/chzzk.py — same URLs, camelCase request bodies,
// `content`-wrapped responses and 8-second timeout.
package chzzk

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	AuthURL  = "https://chzzk.naver.com/account-interlock"
	TokenURL = "https://openapi.chzzk.naver.com/auth/v1/token"
	APIURL   = "https://openapi.chzzk.naver.com/open/v1"
	Timeout  = 8 * time.Second

	defaultExpiresIn = 86400
)

type Client struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string

	HTTP     *http.Client
	TokenURL string // overridable in tests
	APIURL   string // overridable in tests
}

func New(clientID, clientSecret, redirectURI string) *Client {
	return &Client{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURI:  redirectURI,
		HTTP:         &http.Client{Timeout: Timeout},
		TokenURL:     TokenURL,
		APIURL:       APIURL,
	}
}

type Token struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int // seconds
}

type User struct {
	ChannelID string
	Nickname  string
}

// AuthorizeURL is where the browser is sent to grant access (redirects back to
// RedirectURI with ?code=&state=).
func (c *Client) AuthorizeURL(state string) string {
	q := url.Values{}
	q.Set("clientId", c.ClientID)
	q.Set("redirectUri", c.RedirectURI)
	q.Set("state", state)
	return AuthURL + "?" + q.Encode()
}

func (c *Client) ExchangeCode(ctx context.Context, code, state string) (Token, error) {
	return c.token(ctx, map[string]string{
		"grantType":    "authorization_code",
		"clientId":     c.ClientID,
		"clientSecret": c.ClientSecret,
		"code":         code,
		"state":        state,
	})
}

func (c *Client) Refresh(ctx context.Context, refreshToken string) (Token, error) {
	return c.token(ctx, map[string]string{
		"grantType":    "refresh_token",
		"clientId":     c.ClientID,
		"clientSecret": c.ClientSecret,
		"refreshToken": refreshToken,
	})
}

func (c *Client) token(ctx context.Context, body map[string]string) (Token, error) {
	var out struct {
		AccessToken  string      `json:"accessToken"`
		RefreshToken string      `json:"refreshToken"`
		ExpiresIn    json.Number `json:"expiresIn"`
	}
	if err := c.do(ctx, http.MethodPost, c.TokenURL, "", body, &out); err != nil {
		return Token{}, err
	}
	if out.AccessToken == "" {
		return Token{}, fmt.Errorf("chzzk: token response missing accessToken")
	}
	expires := defaultExpiresIn
	if n, err := out.ExpiresIn.Int64(); err == nil && n > 0 {
		expires = int(n)
	}
	return Token{AccessToken: out.AccessToken, RefreshToken: out.RefreshToken, ExpiresIn: expires}, nil
}

func (c *Client) Me(ctx context.Context, accessToken string) (User, error) {
	var out struct {
		ChannelID   string `json:"channelId"`
		ChannelName string `json:"channelName"`
	}
	if err := c.do(ctx, http.MethodGet, c.APIURL+"/users/me", accessToken, nil, &out); err != nil {
		return User{}, err
	}
	return User{ChannelID: out.ChannelID, Nickname: out.ChannelName}, nil
}

// UserSessionURL returns the socket URL for a user session (only the token
// owner's own events can be subscribed). Appends auth=<accessToken> when the
// returned URL carries no auth param — same as the Python client.
func (c *Client) UserSessionURL(ctx context.Context, accessToken string) (string, error) {
	var out struct {
		URL string `json:"url"`
	}
	if err := c.do(ctx, http.MethodGet, c.APIURL+"/sessions/auth", accessToken, nil, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", fmt.Errorf("chzzk: session response missing url")
	}
	u := out.URL
	if !strings.Contains(u, "?auth=") {
		sep := "?"
		if strings.Contains(u, "?") {
			sep = "&"
		}
		u += sep + "auth=" + accessToken
	}
	return u, nil
}

func (c *Client) SubscribeChat(ctx context.Context, accessToken, sessionKey string) error {
	u := c.APIURL + "/sessions/events/subscribe/chat?sessionKey=" + url.QueryEscape(sessionKey)
	return c.do(ctx, http.MethodPost, u, accessToken, nil, nil)
}

// do sends a JSON request and decodes the (optionally `content`-wrapped) JSON
// response into out. Error messages never include tokens or response bodies.
func (c *Client) do(ctx context.Context, method, u, bearer string, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("chzzk: %s %s: %w", method, redactURL(u), err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("chzzk: %s %s: HTTP %d", method, redactURL(u), resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return decodeContent(raw, out)
}

// decodeContent mirrors Python's `data.get("content") or data`.
func decodeContent(raw []byte, out any) error {
	var env struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("chzzk: decode response: %w", err)
	}
	if c := bytes.TrimSpace(env.Content); len(c) > 0 && !bytes.Equal(c, []byte("null")) && !bytes.Equal(c, []byte("{}")) {
		raw = c
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("chzzk: decode response: %w", err)
	}
	return nil
}

func redactURL(u string) string {
	if i := strings.IndexByte(u, '?'); i >= 0 {
		return u[:i]
	}
	return u
}

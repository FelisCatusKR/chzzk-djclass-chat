// Package varchive is the V-ARCHIVE open API client (port of
// djclass/varchive.py). Token-less by design: the viewer's 조회토큰 is used once
// (LookupUser) to prove ownership and capture {userNo, nickname}, and is never
// stored; DJ CLASS sync uses the public per-nickname endpoint.
package varchive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

const (
	BaseURL = "https://v-archive.net"
	Timeout = 8 * time.Second
	// maxInFlight caps concurrent V-ARCHIVE requests process-wide, so a rush of
	// viewers linking at once queues here instead of hammering V-ARCHIVE.
	maxInFlight = 8
)

// Buttons are the DJMAX button modes (there is no 7-button mode).
var Buttons = []int{4, 5, 6, 8}

var (
	// ErrInvalidToken: the 조회토큰 was rejected (HTTP 401 or success=false).
	ErrInvalidToken = errors.New("varchive: invalid token")
	// ErrUnavailable: network failure, timeout or unexpected status.
	ErrUnavailable = errors.New("varchive: request failed")
)

type User struct {
	UserNo   int64
	Nickname string
}

type DjClass struct {
	Button          int
	Class           string
	PowerSum        *float64
	MaxPower        *float64
	PowerConversion *float64
}

type Client struct {
	HTTP    *http.Client
	BaseURL string // overridable in tests
	sem     chan struct{}
}

func New() *Client {
	return &Client{HTTP: &http.Client{Timeout: Timeout}, BaseURL: BaseURL, sem: make(chan struct{}, maxInFlight)}
}

// get performs one GET (bounded by the in-flight cap) and returns status + body.
// Errors never include the token.
func (c *Client) get(ctx context.Context, path, bearer string) (int, []byte, error) {
	select {
	case c.sem <- struct{}{}:
		defer func() { <-c.sem }()
	case <-ctx.Done():
		return 0, nil, fmt.Errorf("%w: %v", ErrUnavailable, ctx.Err())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return 0, nil, err
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return resp.StatusCode, body, nil
}

// LookupUser verifies a 조회토큰 (GET /api/v2/open-token/user).
func (c *Client) LookupUser(ctx context.Context, token string) (User, error) {
	status, body, err := c.get(ctx, "/api/v2/open-token/user", token)
	if err != nil {
		return User{}, err
	}
	if status == http.StatusUnauthorized {
		return User{}, ErrInvalidToken
	}
	if status != http.StatusOK {
		return User{}, fmt.Errorf("%w: HTTP %d", ErrUnavailable, status)
	}
	var out struct {
		Success  bool    `json:"success"`
		UserNo   *int64  `json:"userNo"`
		Nickname *string `json:"nickname"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return User{}, fmt.Errorf("%w: bad JSON", ErrUnavailable)
	}
	if !out.Success || out.UserNo == nil || out.Nickname == nil {
		return User{}, ErrInvalidToken
	}
	return User{UserNo: *out.UserNo, Nickname: *out.Nickname}, nil
}

// DjClassFor fetches one button's public DJ CLASS. ok=false means no class
// for that button (404, success=false, or empty class).
func (c *Client) DjClassFor(ctx context.Context, nickname string, button int) (DjClass, bool, error) {
	path := "/api/v2/archive/" + url.PathEscape(nickname) + "/djClass/" + strconv.Itoa(button)
	status, body, err := c.get(ctx, path, "")
	if err != nil {
		return DjClass{}, false, err
	}
	if status != http.StatusOK {
		return DjClass{}, false, nil
	}
	var out struct {
		Success           bool     `json:"success"`
		DjClass           string   `json:"djClass"`
		DjPowerSum        *float64 `json:"djPowerSum"`
		MaxDjPower        *float64 `json:"maxDjPower"`
		DjPowerConversion *float64 `json:"djPowerConversion"`
	}
	if err := json.Unmarshal(body, &out); err != nil || !out.Success || out.DjClass == "" {
		return DjClass{}, false, nil
	}
	return DjClass{Button: button, Class: out.DjClass, PowerSum: out.DjPowerSum, MaxPower: out.MaxDjPower, PowerConversion: out.DjPowerConversion}, true, nil
}

// AllDjClasses fetches every button (concurrently) and returns those that have
// a class, in button order. Per-button failures are skipped, so a stale
// nickname or a V-ARCHIVE outage yields an empty result, not an error.
func (c *Client) AllDjClasses(ctx context.Context, nickname string) []DjClass {
	results := make([]*DjClass, len(Buttons))
	var wg sync.WaitGroup
	for i, b := range Buttons {
		wg.Go(func() {
			if dc, ok, err := c.DjClassFor(ctx, nickname, b); err == nil && ok {
				results[i] = &dc
			}
		})
	}
	wg.Wait()
	var out []DjClass
	for _, r := range results {
		if r != nil {
			out = append(out, *r)
		}
	}
	return out
}

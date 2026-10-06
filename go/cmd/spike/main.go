// Command spike is a throwaway harness to validate the Go Chzzk stack against
// the live service: log in via Chzzk OAuth, open a user session socket with the
// eio3 client, subscribe to chat, and print what arrives. Delete once the real
// server exists; internal/chzzk and internal/chzzk/eio3 are the keepers.
//
//	go run ./cmd/spike [-raw] [-probe] [-refresh]
//	open http://localhost:8000/login
//
// Reads CHZZK_CLIENT_ID / CHZZK_CLIENT_SECRET (and optional BASE_URL) from the
// environment or the -env file. Never prints tokens or the session URL.
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk/eio3"
)

const reconnectDelay = 5 * time.Second // ingestor.RECONNECT_DELAY

var (
	addr    = flag.String("addr", ":8000", "listen address")
	envFile = flag.String("env", ".env", "dotenv file with CHZZK_CLIENT_ID / CHZZK_CLIENT_SECRET")
	raw     = flag.Bool("raw", false, "trace every raw Engine.IO frame")
	probe   = flag.Bool("probe", false, "compare EIO=3 / EIO=4 polling handshakes before connecting")
	refresh = flag.Bool("refresh", false, "exercise the refresh_token grant right after login")
)

type stats struct {
	started    time.Time
	sessions   atomic.Int64
	chats      atomic.Int64
	lastReason atomic.Value // string
}

func main() {
	flag.Parse()
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	if err := loadDotenv(*envFile); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Fatalf("env file: %v", err)
	}
	id, secret := os.Getenv("CHZZK_CLIENT_ID"), os.Getenv("CHZZK_CLIENT_SECRET")
	if id == "" || secret == "" {
		log.Fatal("CHZZK_CLIENT_ID and CHZZK_CLIENT_SECRET are required")
	}
	base := strings.TrimRight(envOr("BASE_URL", "http://localhost:8000"), "/")
	client := chzzk.New(id, secret, base+"/api/auth/chzzk/callback")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st := &stats{started: time.Now()}
	var (
		states   sync.Map // state -> expiry time.Time
		runnerMu sync.Mutex
		running  bool
	)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<p>Chzzk spike — <a href="/login">치지직으로 로그인</a></p>`)
	})
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		state := randomHex(32)
		states.Store(state, time.Now().Add(5*time.Minute))
		http.Redirect(w, r, client.AuthorizeURL(state), http.StatusFound)
	})
	mux.HandleFunc("GET /api/auth/chzzk/callback", func(w http.ResponseWriter, r *http.Request) {
		code, state := r.URL.Query().Get("code"), r.URL.Query().Get("state")
		exp, ok := states.LoadAndDelete(state)
		if code == "" || !ok || time.Now().After(exp.(time.Time)) {
			http.Error(w, "state 불일치 또는 만료", http.StatusBadRequest)
			return
		}
		tok, err := client.ExchangeCode(r.Context(), code, state)
		if err != nil {
			log.Printf("[oauth] exchange failed: %v", err)
			http.Error(w, "토큰 교환 실패", http.StatusBadGateway)
			return
		}
		log.Printf("[oauth] token ok (expiresIn=%ds, refresh=%t)", tok.ExpiresIn, tok.RefreshToken != "")
		if *refresh {
			tok, err = client.Refresh(r.Context(), tok.RefreshToken)
			if err != nil {
				log.Printf("[oauth] refresh failed: %v", err)
				http.Error(w, "토큰 갱신 실패", http.StatusBadGateway)
				return
			}
			log.Printf("[oauth] refresh ok (expiresIn=%ds)", tok.ExpiresIn)
		}
		me, err := client.Me(r.Context(), tok.AccessToken)
		if err != nil {
			log.Printf("[oauth] users/me failed: %v", err)
			http.Error(w, "사용자 조회 실패", http.StatusBadGateway)
			return
		}
		log.Printf("[oauth] logged in as %q (channel %s)", me.Nickname, me.ChannelID)

		runnerMu.Lock()
		start := !running
		running = true
		runnerMu.Unlock()
		if start {
			go runSessions(ctx, client, tok.AccessToken, st)
		}
		fmt.Fprintf(w, "로그인 완료: %s — 터미널을 확인하세요. 이 채널에 채팅을 입력하면 출력됩니다.\n", me.Nickname)
	})

	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Printf("listening on %s — open %s/login", *addr, base)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}

	reason, _ := st.lastReason.Load().(string)
	log.Printf("[summary] uptime=%s sessions=%d chats=%d lastEnd=%q",
		time.Since(st.started).Round(time.Second), st.sessions.Load(), st.chats.Load(), reason)
}

// runSessions keeps one user-session socket open until ctx ends, reconnecting
// with a fresh session URL after a fixed delay (like the Python ingestor).
func runSessions(ctx context.Context, client *chzzk.Client, token string, st *stats) {
	probed := false
	for ctx.Err() == nil {
		reqCtx, cancel := context.WithTimeout(ctx, chzzk.Timeout)
		sessionURL, err := client.UserSessionURL(reqCtx, token)
		cancel()
		if err != nil {
			log.Printf("[session] url failed: %v", err)
			sleep(ctx, reconnectDelay)
			continue
		}
		if *probe && !probed {
			probed = true
			probeVersions(ctx, sessionURL)
		}

		opts := eio3.Options{}
		if *raw {
			opts.Trace = func(dir, frame string) { log.Printf("[frame] %s %s", dir, clip(frame, 300)) }
		}
		dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		conn, err := eio3.Dial(dialCtx, sessionURL, opts)
		cancel()
		if err != nil {
			log.Printf("[session] dial failed: %v", err)
			sleep(ctx, reconnectDelay)
			continue
		}
		n := st.sessions.Add(1)
		hs := conn.Handshake
		log.Printf("[session #%d] connected (pingInterval=%dms pingTimeout=%dms upgrades=%v)",
			n, hs.PingInterval, hs.PingTimeout, hs.Upgrades)
		began := time.Now()

		err = conn.Run(ctx, func(ev eio3.Event) { handleEvent(ctx, client, token, ev, st) })
		st.lastReason.Store(err.Error())
		log.Printf("[session #%d] ended after %s: %v", n, time.Since(began).Round(time.Second), err)
		sleep(ctx, reconnectDelay)
	}
}

func handleEvent(ctx context.Context, client *chzzk.Client, token string, ev eio3.Event, st *stats) {
	var data map[string]any
	if len(ev.Args) > 0 {
		data = eio3.DecodeArg(ev.Args[0])
	}
	switch ev.Name {
	case "SYSTEM":
		log.Printf("[SYSTEM] type=%v", data["type"])
		if data["type"] != "connected" {
			return
		}
		inner, _ := data["data"].(map[string]any)
		key, _ := inner["sessionKey"].(string)
		if key == "" {
			log.Printf("[SYSTEM] connected without sessionKey")
			return
		}
		// Subscribe off the read goroutine so pongs keep flowing.
		go func() {
			reqCtx, cancel := context.WithTimeout(ctx, chzzk.Timeout)
			defer cancel()
			if err := client.SubscribeChat(reqCtx, token, key); err != nil {
				log.Printf("[subscribe] failed: %v", err)
				return
			}
			log.Printf("[subscribe] chat subscribed")
		}()
	case "CHAT":
		st.chats.Add(1)
		profile, _ := data["profile"].(map[string]any)
		nick := firstString(profile["nickname"], data["nickname"])
		sender := firstString(profile["senderChannelId"], data["senderChannelId"])
		emojis, _ := data["emojis"].(map[string]any)
		ts := ""
		if ms, ok := data["messageTime"].(float64); ok && ms > 0 {
			ts = time.UnixMilli(int64(ms)).Format("15:04:05.000")
		}
		log.Printf("[CHAT] %s %s(%s): %s  emojis=%d", ts, nick, sender, data["content"], len(emojis))
	default:
		log.Printf("[%s] %d args", ev.Name, len(ev.Args))
	}
}

// probeVersions asks the polling transport for an EIO=3 and an EIO=4 handshake
// and prints how the server answers, to pin down the protocol version.
func probeVersions(ctx context.Context, sessionURL string) {
	wsURL, err := eio3.SocketURL(sessionURL)
	if err != nil {
		log.Printf("[probe] %v", err)
		return
	}
	u, _ := url.Parse(wsURL)
	u.Scheme = strings.Replace(u.Scheme, "ws", "http", 1)
	for _, v := range []string{"3", "4"} {
		q := u.Query()
		q.Set("EIO", v)
		q.Set("transport", "polling")
		pu := *u
		pu.RawQuery = q.Encode()
		reqCtx, cancel := context.WithTimeout(ctx, chzzk.Timeout)
		req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, pu.String(), nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			cancel()
			log.Printf("[probe] EIO=%s: request failed", v) // err embeds the auth URL
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		resp.Body.Close()
		cancel()
		log.Printf("[probe] EIO=%s: HTTP %d %s", v, resp.StatusCode, strconv.Quote(clip(string(body), 300)))
	}
}

func firstString(vs ...any) string {
	for _, v := range vs {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// loadDotenv sets KEY=VALUE lines from path without overriding the real env.
func loadDotenv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		if _, set := os.LookupEnv(k); !set {
			_ = os.Setenv(k, v)
		}
	}
	return sc.Err()
}

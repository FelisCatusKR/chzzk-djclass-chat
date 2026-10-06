package eio3

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestSocketURL(t *testing.T) {
	cases := []struct{ in, want string }{
		{"https://ssio08.nchat.naver.com:443?auth=A%2BB", "wss://ssio08.nchat.naver.com:443/socket.io/?auth=A%2BB&transport=websocket&EIO=3"},
		{"wss://host/abc?auth=X", "wss://host/socket.io/?auth=X&transport=websocket&EIO=3"},
		{"http://localhost:1234", "ws://localhost:1234/socket.io/?transport=websocket&EIO=3"},
	}
	for _, tc := range cases {
		got, err := SocketURL(tc.in)
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Errorf("SocketURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
	if _, err := SocketURL("ftp://x"); err == nil {
		t.Error("want error for ftp scheme")
	}
}

func TestParseSocketPacket(t *testing.T) {
	ev, closed, ok := parseSocketPacket(`2["CHAT","{\"content\":\"hi\"}"]`)
	if !ok || closed || ev.Name != "CHAT" || len(ev.Args) != 1 {
		t.Fatalf("event = %+v ok=%v closed=%v", ev, ok, closed)
	}
	if ev, _, ok := parseSocketPacket(`212["SYSTEM",{}]`); !ok || ev.Name != "SYSTEM" {
		t.Errorf("ack-id event = %+v ok=%v", ev, ok)
	}
	if _, closed, _ := parseSocketPacket("1"); !closed {
		t.Error("disconnect not detected")
	}
	for _, p := range []string{"", "0", `2/other,["X"]`, `2[]`, `2[1]`, `2not-json`} {
		if _, _, ok := parseSocketPacket(p); ok {
			t.Errorf("parseSocketPacket(%q) delivered an event", p)
		}
	}
}

func TestDecodeArg(t *testing.T) {
	if m := DecodeArg(json.RawMessage(`"{\"type\":\"connected\"}"`)); m["type"] != "connected" {
		t.Errorf("string-encoded = %v", m)
	}
	if m := DecodeArg(json.RawMessage(`{"type":"connected"}`)); m["type"] != "connected" {
		t.Errorf("object = %v", m)
	}
	for _, in := range []string{`"not json"`, `[1]`, `null`, `42`} {
		if m := DecodeArg(json.RawMessage(in)); m == nil || len(m) != 0 {
			t.Errorf("DecodeArg(%s) = %v, want empty map", in, m)
		}
	}
}

// fakeServer runs script against each accepted websocket and records the
// request query so tests can check what the client asked for.
func fakeServer(t *testing.T, script func(ctx context.Context, ws *websocket.Conn)) (string, chan string) {
	t.Helper()
	queries := make(chan string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries <- r.URL.Path + "?" + r.URL.RawQuery
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer ws.CloseNow()
		script(r.Context(), ws)
	}))
	t.Cleanup(srv.Close)
	return srv.URL + "?auth=TOK", queries
}

func send(ctx context.Context, ws *websocket.Conn, s string) {
	_ = ws.Write(ctx, websocket.MessageText, []byte(s))
}

const open = `0{"sid":"s1","upgrades":[],"pingInterval":50,"pingTimeout":100}`

func TestDialRunHappyPath(t *testing.T) {
	gotPing := make(chan struct{}, 1)
	sessionURL, queries := fakeServer(t, func(ctx context.Context, ws *websocket.Conn) {
		send(ctx, ws, open)
		send(ctx, ws, "40")
		send(ctx, ws, `42["SYSTEM","{\"type\":\"connected\",\"data\":{\"sessionKey\":\"K\"}}"]`)
		for {
			_, b, err := ws.Read(ctx)
			if err != nil {
				return
			}
			if string(b) == "2" {
				send(ctx, ws, "3")
				select {
				case gotPing <- struct{}{}:
					send(ctx, ws, `42["CHAT",{"content":"안녕"}]`)
					send(ctx, ws, "41")
				default:
				}
			}
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, sessionURL, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if q := <-queries; q != "/socket.io/?auth=TOK&transport=websocket&EIO=3" {
		t.Errorf("request = %q", q)
	}
	if conn.Handshake.SID != "s1" || conn.Handshake.PingInterval != 50 {
		t.Errorf("handshake = %+v", conn.Handshake)
	}
	var names []string
	err = conn.Run(ctx, func(ev Event) {
		names = append(names, ev.Name)
		if ev.Name == "CHAT" && DecodeArg(ev.Args[0])["content"] != "안녕" {
			t.Errorf("chat args = %s", ev.Args[0])
		}
	})
	if !errors.Is(err, ErrServerClosed) {
		t.Errorf("Run = %v, want ErrServerClosed", err)
	}
	if strings.Join(names, ",") != "SYSTEM,CHAT" {
		t.Errorf("events = %v", names)
	}
}

func TestRunHeartbeatTimeout(t *testing.T) {
	sessionURL, _ := fakeServer(t, func(ctx context.Context, ws *websocket.Conn) {
		send(ctx, ws, open)
		send(ctx, ws, "40")
		for { // swallow pings, never pong
			if _, _, err := ws.Read(ctx); err != nil {
				return
			}
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, sessionURL, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Run(ctx, func(Event) {}); !errors.Is(err, ErrHeartbeatTimeout) {
		t.Errorf("Run = %v, want ErrHeartbeatTimeout", err)
	}
}

func TestDialRequiresNamespaceConnect(t *testing.T) {
	sessionURL, _ := fakeServer(t, func(ctx context.Context, ws *websocket.Conn) {
		send(ctx, ws, open)
		send(ctx, ws, `42["CHAT",{}]`) // event before "40"
		_, _, _ = ws.Read(ctx)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := Dial(ctx, sessionURL, Options{}); err == nil {
		t.Fatal("want error when 40 is missing")
	}
}

func TestDialErrorRedactsAuth(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := Dial(ctx, "http://127.0.0.1:1?auth=SUPERSECRET", Options{})
	if err == nil {
		t.Fatal("want dial error")
	}
	if strings.Contains(err.Error(), "SUPERSECRET") {
		t.Errorf("error leaks auth: %v", err)
	}
}

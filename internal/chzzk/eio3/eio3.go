// Package eio3 is a minimal, receive-only Socket.IO v2 client (Engine.IO
// protocol v3, Socket.IO protocol v4) over the websocket transport — just what
// the Chzzk session socket needs: handshake, the default "/" namespace, client
// ping/pong, and incoming EVENT packets. No polling, emit, acks, binary or
// reconnection (the caller reconnects with a fresh session URL).
//
// Chzzk documents support for socket.io-client 1.0.0–2.0.3 only, so the
// Engine.IO v4 clients (python-socketio 5.x, socket.io-client 3+) don't apply.
//
// Verified against the live Chzzk session server (2026-10, cmd/spike):
//   - EIO3 only: an EIO=4 handshake is answered in v3 format (no maxPayload);
//     the server sends "40" unprompted; the client pings, the server pongs.
//     Handshake: pingInterval=25000, pingTimeout=60000.
//   - A session URL is single-use: any earlier handshake on the same URL (even
//     a polling probe) makes the websocket get 42["error","auth fail"] + "41".
//     Always fetch a fresh URL before each (re)connect.
//   - The server closes sessions on its own (one closed after ~18.7 h); expect
//     ErrServerClosed in normal operation and reconnect.
//   - An open session outlives its access token (one ran ~18.5 h past expiry):
//     the token is only used to fetch the URL and to subscribe, so refresh it
//     before reconnecting, not on a timer.
package eio3

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// Engine.IO v3 packet types (first byte of a text frame).
const (
	pOpen    = '0'
	pClose   = '1'
	pPing    = '2'
	pPong    = '3'
	pMessage = '4'
	pUpgrade = '5'
	pNoop    = '6'
)

// Socket.IO v4 packet types (first byte after an Engine.IO '4').
const (
	sDisconnect = '1'
	sEvent      = '2'
	sError      = '4'
)

var (
	ErrServerClosed     = errors.New("eio3: server closed the session")
	ErrHeartbeatTimeout = errors.New("eio3: heartbeat timeout")
)

// Event is one incoming Socket.IO EVENT: 42["NAME", arg0, arg1, ...].
type Event struct {
	Name string
	Args []json.RawMessage
}

// Handshake is the Engine.IO open packet payload.
type Handshake struct {
	SID          string   `json:"sid"`
	Upgrades     []string `json:"upgrades"`
	PingInterval int      `json:"pingInterval"` // ms
	PingTimeout  int      `json:"pingTimeout"`  // ms
}

type Options struct {
	// Trace, if set, sees every raw frame ("<" received, ">" sent). Frames may
	// carry chat content; the URL (with its auth token) is never passed here.
	Trace func(dir, frame string)
}

type Conn struct {
	ws        *websocket.Conn
	opts      Options
	Handshake Handshake
}

// SocketURL turns the session URL Chzzk returns (e.g.
// "https://ssio08.nchat.naver.com:443?auth=XXX") into the Engine.IO websocket
// endpoint, the way socket.io-client / python-socketio 4.x do: scheme → ws(s),
// path → /socket.io/, original query kept verbatim, then transport + EIO=3.
func SocketURL(sessionURL string) (string, error) {
	u, err := url.Parse(sessionURL)
	if err != nil {
		// Not wrapped: *url.Error quotes the whole URL, including the auth token.
		return "", errors.New("eio3: bad session url")
	}
	switch u.Scheme {
	case "https", "wss":
		u.Scheme = "wss"
	case "http", "ws":
		u.Scheme = "ws"
	default:
		return "", fmt.Errorf("eio3: unsupported scheme %q", u.Scheme)
	}
	u.Path = "/socket.io/"
	q := u.RawQuery
	if q != "" {
		q += "&"
	}
	u.RawQuery = q + "transport=websocket&EIO=3"
	u.Fragment = ""
	return u.String(), nil
}

// Dial connects, reads the Engine.IO open packet and waits for the server's
// default-namespace CONNECT ("40"), which a Socket.IO v2 server sends unprompted.
func Dial(ctx context.Context, sessionURL string, opts Options) (*Conn, error) {
	wsURL, err := SocketURL(sessionURL)
	if err != nil {
		return nil, err
	}
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		// The error may embed the URL; don't wrap it verbatim (auth token).
		return nil, fmt.Errorf("eio3: websocket dial failed: %s", redactErr(err, wsURL))
	}
	ws.SetReadLimit(1 << 20)
	c := &Conn{ws: ws, opts: opts}

	frame, err := c.read(ctx)
	if err != nil {
		ws.CloseNow()
		return nil, fmt.Errorf("eio3: reading open packet: %w", err)
	}
	if len(frame) == 0 || frame[0] != pOpen {
		ws.CloseNow()
		return nil, fmt.Errorf("eio3: expected open packet, got %q", truncate(frame, 64))
	}
	if err := json.Unmarshal([]byte(frame[1:]), &c.Handshake); err != nil {
		ws.CloseNow()
		return nil, fmt.Errorf("eio3: bad open packet: %w", err)
	}
	if c.Handshake.PingInterval <= 0 || c.Handshake.PingTimeout <= 0 {
		ws.CloseNow()
		return nil, fmt.Errorf("eio3: open packet missing ping settings")
	}

	for {
		frame, err := c.read(ctx)
		if err != nil {
			ws.CloseNow()
			return nil, fmt.Errorf("eio3: waiting for namespace connect: %w", err)
		}
		switch {
		case frame == "40" || strings.HasPrefix(frame, "40{"):
			return c, nil
		case strings.HasPrefix(frame, "44"):
			ws.CloseNow()
			return nil, fmt.Errorf("eio3: namespace connect error: %s", truncate(frame[2:], 200))
		case frame != "" && (frame[0] == pPing || frame[0] == pNoop):
			if frame[0] == pPing {
				_ = c.write(ctx, string(pPong)+frame[1:])
			}
		default:
			ws.CloseNow()
			return nil, fmt.Errorf("eio3: unexpected frame before namespace connect: %q", truncate(frame, 64))
		}
	}
}

// Run delivers incoming events to handle until the session ends. It always
// returns a non-nil error: ctx.Err(), ErrServerClosed, ErrHeartbeatTimeout, or
// a websocket error. handle runs on the caller's goroutine and must not block
// for long (pings and timeouts are serviced between events).
//
// Heartbeat follows engine.io-client 3.x (lib/socket.js setPing/onHeartbeat),
// the client Chzzk documents: the first ping goes out pingInterval after the
// handshake and the next one pingInterval after each pong; every received frame
// pushes the deadline to pingInterval+pingTimeout, and sending a ping sets it
// to pingTimeout. Missing the deadline is a "ping timeout".
func (c *Conn) Run(ctx context.Context, handle func(Event)) error {
	defer c.ws.CloseNow()
	interval := time.Duration(c.Handshake.PingInterval) * time.Millisecond
	timeout := time.Duration(c.Handshake.PingTimeout) * time.Millisecond

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	frames := make(chan string)
	readErr := make(chan error, 1)
	go func() {
		for {
			f, err := c.read(ctx)
			if err != nil {
				readErr <- err
				return
			}
			select {
			case frames <- f:
			case <-ctx.Done():
				return
			}
		}
	}()

	pingTimer := time.NewTimer(interval)
	defer pingTimer.Stop()
	deadline := time.NewTimer(interval + timeout)
	defer deadline.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-readErr:
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		case <-deadline.C:
			return ErrHeartbeatTimeout
		case <-pingTimer.C:
			if err := c.write(ctx, string(pPing)); err != nil {
				return err
			}
			deadline.Reset(timeout)
		case frame := <-frames:
			deadline.Reset(interval + timeout)
			if frame == "" {
				continue
			}
			switch frame[0] {
			case pPong:
				pingTimer.Reset(interval)
			case pPing: // not sent by an EIO3 server; answer anyway
				_ = c.write(ctx, string(pPong)+frame[1:])
			case pClose:
				return ErrServerClosed
			case pMessage:
				ev, closed, ok := parseSocketPacket(frame[1:])
				if closed {
					return ErrServerClosed
				}
				if ok {
					handle(ev)
				}
			case pOpen, pUpgrade, pNoop:
			}
		}
	}
}

func (c *Conn) Close() error {
	return c.ws.Close(websocket.StatusNormalClosure, "")
}

// parseSocketPacket parses a Socket.IO v4 packet (the text after Engine.IO '4'),
// like socket.io-parser 3.x: type, optional "/nsp,", optional ack id, JSON data.
// Default-namespace EVENTs are delivered, an ERROR is delivered as an "error"
// event (socket.io-client 2.x emits 'error' and stays connected), and closed
// reports a DISCONNECT. Ack requests are not answered: socket.io-client 2.x only
// acks when a handler calls back, and Chzzk's documented handlers never do.
func parseSocketPacket(p string) (ev Event, closed, ok bool) {
	if p == "" {
		return Event{}, false, false
	}
	typ, rest := p[0], p[1:]
	if strings.HasPrefix(rest, "/") {
		nsp := rest
		if i := strings.IndexByte(rest, ','); i >= 0 {
			nsp, rest = rest[:i], rest[i+1:]
		} else {
			rest = ""
		}
		if i := strings.IndexByte(nsp, '?'); i >= 0 {
			nsp = nsp[:i]
		}
		if nsp != "/" {
			return Event{}, false, false // only the default namespace is joined
		}
	}
	switch typ {
	case sDisconnect:
		return Event{}, true, false
	case sError:
		arg := json.RawMessage(rest)
		if !json.Valid(arg) {
			arg, _ = json.Marshal(rest)
		}
		return Event{Name: "error", Args: []json.RawMessage{arg}}, false, true
	case sEvent:
	default: // connect, ack, binary — not used by Chzzk
		return Event{}, false, false
	}
	i := 0 // optional ack id: leading digits before the JSON array
	for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
		i++
	}
	var arr []json.RawMessage
	if err := json.Unmarshal([]byte(rest[i:]), &arr); err != nil || len(arr) == 0 {
		return Event{}, false, false
	}
	var name string
	if err := json.Unmarshal(arr[0], &name); err != nil {
		return Event{}, false, false
	}
	return Event{Name: name, Args: arr[1:]}, false, true
}

func (c *Conn) read(ctx context.Context) (string, error) {
	for {
		typ, b, err := c.ws.Read(ctx)
		if err != nil {
			return "", err
		}
		if typ != websocket.MessageText {
			continue // binary attachments are not used
		}
		s := string(b)
		if c.opts.Trace != nil {
			c.opts.Trace("<", s)
		}
		return s, nil
	}
}

func (c *Conn) write(ctx context.Context, s string) error {
	if c.opts.Trace != nil {
		c.opts.Trace(">", s)
	}
	return c.ws.Write(ctx, websocket.MessageText, []byte(s))
}

// DecodeArg mirrors ingestor.parse(): an arg is either a JSON object or a JSON
// string holding a JSON object. Anything else yields an empty map.
func DecodeArg(arg json.RawMessage) map[string]any {
	var s string
	if err := json.Unmarshal(arg, &s); err == nil {
		arg = json.RawMessage(s)
	}
	var m map[string]any
	if err := json.Unmarshal(arg, &m); err != nil || m == nil {
		return map[string]any{}
	}
	return m
}

func redactErr(err error, secretURL string) string {
	msg := err.Error()
	if u, perr := url.Parse(secretURL); perr == nil {
		if a := u.Query().Get("auth"); a != "" {
			msg = strings.ReplaceAll(msg, a, "REDACTED")
			msg = strings.ReplaceAll(msg, url.QueryEscape(a), "REDACTED")
		}
	}
	return msg
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…(" + strconv.Itoa(len(s)) + " bytes)"
}

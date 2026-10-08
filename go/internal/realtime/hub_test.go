package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk/eio3"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/djclass"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/resolver"
)

// --- fakes -----------------------------------------------------------------

type fakeTokens struct {
	mu   sync.Mutex
	errs []error // returned in order before succeeding
}

func (f *fakeTokens) AccessToken(context.Context, string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.errs) > 0 {
		err := f.errs[0]
		f.errs = f.errs[1:]
		return "", err
	}
	return "TOKEN", nil
}

type fakeAPI struct {
	urlCalls   atomic.Int64
	urlErrs    atomic.Int64 // fail this many URL fetches first
	subCalls   atomic.Int64
	subErrs    atomic.Int64 // fail this many subscribes first
	subscribed chan string  // session keys successfully subscribed
}

func (f *fakeAPI) UserSessionURL(_ context.Context, token string) (string, error) {
	n := f.urlCalls.Add(1)
	if token != "TOKEN" {
		return "", errors.New("bad token")
	}
	if f.urlErrs.Load() > 0 {
		f.urlErrs.Add(-1)
		return "", errors.New("chzzk: HTTP 503")
	}
	return fmt.Sprintf("https://chat/%d", n), nil
}

func (f *fakeAPI) SubscribeChat(_ context.Context, _, key string) error {
	f.subCalls.Add(1)
	if f.subErrs.Load() > 0 {
		f.subErrs.Add(-1)
		return errors.New("chzzk: HTTP 500")
	}
	f.subscribed <- key
	return nil
}

// fakeSocket sends SYSTEM connected (sessionKey = the URL), then delivers
// whatever the test pushes on events, until the test ends it or ctx is done.
type fakeSocket struct {
	url    string
	events chan eio3.Event
	end    chan error
	closed atomic.Bool
}

func (s *fakeSocket) Run(ctx context.Context, handle func(eio3.Event)) error {
	handle(eio3.Event{Name: "SYSTEM", Args: []json.RawMessage{
		json.RawMessage(fmt.Sprintf(`"{\"type\":\"connected\",\"data\":{\"sessionKey\":\"%s\"}}"`, s.url)),
	}})
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-s.end:
			return err
		case ev := <-s.events:
			handle(ev)
		}
	}
}

func (s *fakeSocket) Close() error { s.closed.Store(true); return nil }

type fakeResolver struct {
	calls atomic.Int64
	fail  bool
}

func (r *fakeResolver) Resolve(_ context.Context, sender string) (resolver.Result, error) {
	r.calls.Add(1)
	if r.fail {
		return resolver.Result{}, errors.New("db down")
	}
	if sender == "linked" {
		b := djclass.BuildBadge(djclass.Row{Button: 4, Class: "SHOWSTOPPER II"})
		return resolver.Result{Status: resolver.Linked, Badge: &resolver.Badges{Auto: b, Viewer: b}}, nil
	}
	return resolver.Result{Status: resolver.Unlinked}, nil
}

type harness struct {
	hub     *Hub
	api     *fakeAPI
	tokens  *fakeTokens
	res     *fakeResolver
	sockets chan *fakeSocket
	dials   atomic.Int64
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		api:     &fakeAPI{subscribed: make(chan string, 16)},
		tokens:  &fakeTokens{},
		res:     &fakeResolver{},
		sockets: make(chan *fakeSocket, 16),
	}
	h.hub = New(Config{
		Tokens:   h.tokens,
		API:      h.api,
		Resolver: h.res,
		Dial: func(_ context.Context, url string) (Socket, error) {
			h.dials.Add(1)
			s := &fakeSocket{url: url, events: make(chan eio3.Event, 16), end: make(chan error, 1)}
			h.sockets <- s
			return s, nil
		},
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		FlushInterval: 5 * time.Millisecond,
		TeardownDelay: 50 * time.Millisecond,
		MinBackoff:    2 * time.Millisecond,
		MaxBackoff:    10 * time.Millisecond,
	})
	t.Cleanup(h.hub.Close)
	return h
}

func recv[T any](t *testing.T, c <-chan T, what string) T {
	t.Helper()
	select {
	case v := <-c:
		return v
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
		panic("unreachable")
	}
}

func chatEvent(sender, nick, content string) eio3.Event {
	p, _ := json.Marshal(map[string]any{
		"profile": map[string]any{"senderChannelId": sender, "nickname": nick},
		"content": content, "emojis": map[string]any{"e": "https://ssl.pstatic.net/1.png"},
	})
	s, _ := json.Marshal(string(p)) // Chzzk sends the payload as a JSON string
	return eio3.Event{Name: "CHAT", Args: []json.RawMessage{s}}
}

func decodeBatch(t *testing.T, data []byte) batchPayload {
	t.Helper()
	var b batchPayload
	if err := json.Unmarshal(data, &b); err != nil {
		t.Fatal(err)
	}
	return b
}

// --- tests -----------------------------------------------------------------

func TestChatReachesSubscriber(t *testing.T) {
	h := newHarness(t)
	sub, err := h.hub.Subscribe("chan1")
	if err != nil {
		t.Fatal(err)
	}
	sock := recv(t, h.sockets, "dial")
	if key := recv(t, h.api.subscribed, "subscribe"); key != sock.url {
		t.Errorf("subscribed key %q, want the session's %q", key, sock.url)
	}
	sock.events <- chatEvent("linked", "Viewer", "hello")

	raw := recv(t, sub.C, "batch")
	var generic map[string][]map[string]any // exact wire shape the widget reads
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatal(err)
	}
	m := generic["messages"][0]
	for _, k := range []string{"id", "text", "emojis", "status", "badge", "nickname"} {
		if _, ok := m[k]; !ok {
			t.Errorf("message lacks %q: %v", k, m)
		}
	}
	b := decodeBatch(t, raw).Messages[0]
	if b.Text != "hello" || b.Nickname != "Viewer" || b.Status != resolver.Linked ||
		b.Badge == nil || b.Badge.Auto.Class != "SS II" || b.Emojis["e"] != "https://ssl.pstatic.net/1.png" {
		t.Errorf("message = %+v", b)
	}
}

func TestSubscribersShareOneConnectionAndTeardown(t *testing.T) {
	h := newHarness(t)
	s1, _ := h.hub.Subscribe("chan1")
	s2, _ := h.hub.Subscribe("chan1")
	sock := recv(t, h.sockets, "dial")
	recv(t, h.api.subscribed, "subscribe")

	// Leaving and rejoining within the teardown delay keeps the connection.
	h.hub.Unsubscribe(s1)
	h.hub.Unsubscribe(s2)
	s3, _ := h.hub.Subscribe("chan1")
	time.Sleep(100 * time.Millisecond) // > TeardownDelay
	if sock.closed.Load() || h.dials.Load() != 1 {
		t.Fatalf("rejoin did not cancel teardown: closed=%v dials=%d", sock.closed.Load(), h.dials.Load())
	}

	h.hub.Unsubscribe(s3)
	deadline := time.Now().Add(2 * time.Second)
	for !sock.closed.Load() && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if !sock.closed.Load() {
		t.Fatal("socket not closed after the last subscriber left")
	}
	if h.hub.Inject("chan1", ChatMessage{}) {
		t.Error("channel still registered after teardown")
	}
}

func TestReconnectsWithFreshURLAfterServerClose(t *testing.T) {
	h := newHarness(t)
	h.hub.Subscribe("chan1")
	first := recv(t, h.sockets, "first dial")
	recv(t, h.api.subscribed, "first subscribe")
	first.end <- eio3.ErrServerClosed

	second := recv(t, h.sockets, "redial")
	if second.url == first.url {
		t.Errorf("reused session URL %q (they are single-use)", first.url)
	}
	recv(t, h.api.subscribed, "resubscribe")
}

// Python bug (a): a failing session-URL fetch left the channel never reconnecting.
func TestKeepsRetryingWhenSessionURLFails(t *testing.T) {
	h := newHarness(t)
	h.api.urlErrs.Store(3)
	h.hub.Subscribe("chan1")
	recv(t, h.sockets, "dial after URL failures")
	if got := h.api.urlCalls.Load(); got != 4 {
		t.Errorf("URL fetches = %d, want 3 failures + 1 success", got)
	}
}

// Python bug (b): only one reconnect attempt; and missing tokens must not stop it.
func TestKeepsRetryingWithoutToken(t *testing.T) {
	h := newHarness(t)
	h.tokens.errs = []error{ErrNoToken, ErrNoToken, errors.New("db down")}
	h.hub.Subscribe("chan1")
	recv(t, h.sockets, "dial after token errors")
}

// Python bug (c): a failed subscribe left the socket connected with no chat.
func TestSubscribeRetriesThenRestartsSession(t *testing.T) {
	h := newHarness(t)
	h.api.subErrs.Store(subscribeAttempts + 1) // first session gives up, second retries once
	h.hub.Subscribe("chan1")
	first := recv(t, h.sockets, "first dial")
	second := recv(t, h.sockets, "redial after subscribe gave up")
	if key := recv(t, h.api.subscribed, "subscribe"); key != second.url {
		t.Errorf("subscribed %q, want second session %q", key, second.url)
	}
	if !first.closed.Load() {
		t.Error("abandoned session not closed")
	}
	if got := h.api.subCalls.Load(); got != subscribeAttempts+2 {
		t.Errorf("subscribe calls = %d", got)
	}
}

func TestBuildBatch(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	raw := []ChatMessage{
		{SenderChannelID: "linked", Nickname: "A", Content: "1"},
		{SenderChannelID: "linked", Nickname: "A", Content: "2"},
		{SenderChannelID: "other", Nickname: "B", Content: "3"},
		{SenderChannelID: "other", Nickname: "B", Content: "4"},
	}
	b := h.hub.buildBatch(ctx, raw, log)
	if h.res.calls.Load() != 2 {
		t.Errorf("resolver calls = %d, want one per sender", h.res.calls.Load())
	}
	if len(b.Messages) != 4 || b.Messages[3].Status != resolver.Unlinked || b.Messages[3].Emojis == nil {
		t.Errorf("batch = %+v", b)
	}
	ids := map[int64]bool{}
	for _, m := range b.Messages {
		ids[m.ID] = true
	}
	if len(ids) != 4 {
		t.Errorf("ids not unique: %v", ids)
	}

	many := make([]ChatMessage, maxBatch+50)
	if got := len(h.hub.buildBatch(ctx, many, log).Messages); got != maxBatch {
		t.Errorf("batch size = %d, want cap %d", got, maxBatch)
	}

	h.res.fail = true
	if b := h.hub.buildBatch(ctx, raw[:1], log); b.Messages[0].Status != resolver.Unlinked {
		t.Errorf("resolver error: %+v", b.Messages[0])
	}
}

func TestDropsChatWithoutSubscribers(t *testing.T) {
	h := newHarness(t)
	ch := &channel{id: "x", subs: map[*Subscription]struct{}{}}
	ch.push(ChatMessage{Content: "lost"})
	h.hub.flushOnce(context.Background(), ch, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if len(ch.drain()) != 0 || h.res.calls.Load() != 0 {
		t.Error("buffer not dropped, or resolved for nobody")
	}
}

func TestSubscriberCaps(t *testing.T) {
	h := newHarness(t)
	h.hub.cfg.MaxPerChannel, h.hub.cfg.MaxTotal = 2, 3
	a1, _ := h.hub.Subscribe("a")
	h.hub.Subscribe("a")
	if _, err := h.hub.Subscribe("a"); !errors.Is(err, ErrTooManySubscribers) {
		t.Errorf("3rd on channel a: %v", err)
	}
	h.hub.Subscribe("b")
	if _, err := h.hub.Subscribe("c"); !errors.Is(err, ErrTooManySubscribers) {
		t.Errorf("4th overall: %v", err)
	}
	h.hub.Unsubscribe(a1) // frees a slot
	if _, err := h.hub.Subscribe("c"); err != nil {
		t.Errorf("after unsubscribe: %v", err)
	}
}

func TestInjectAndClose(t *testing.T) {
	h := newHarness(t)
	sub, _ := h.hub.Subscribe("chan1")
	if !h.hub.Inject("chan1", ChatMessage{SenderChannelID: "linked", Nickname: "Dev", Content: "injected"}) {
		t.Fatal("Inject into active channel failed")
	}
	if b := decodeBatch(t, recv(t, sub.C, "injected batch")); b.Messages[0].Text != "injected" {
		t.Errorf("batch = %+v", b)
	}
	if h.hub.Inject("other", ChatMessage{}) {
		t.Error("Inject into inactive channel succeeded")
	}

	h.hub.Close()
	if _, ok := <-sub.C; ok {
		// drain any batch still queued, then it must be closed
		for range sub.C {
		}
	}
	if _, err := h.hub.Subscribe("chan1"); !errors.Is(err, ErrClosed) {
		t.Errorf("Subscribe after Close = %v", err)
	}
	h.hub.Unsubscribe(sub) // no panic after Close
}

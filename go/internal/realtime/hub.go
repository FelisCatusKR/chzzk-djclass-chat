// Package realtime is the chat pipeline: one worker per Chzzk channel ingests
// chat over the session socket, a 250 ms flush resolves badges and fans each
// batch out to the channel's SSE subscribers (widgets).
//
// Lifecycle: the first Subscribe for a channel starts its worker; when the last
// subscriber leaves, the worker is torn down after TeardownDelay unless someone
// subscribes again. All per-channel bookkeeping is guarded by Hub.mu.
package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk/eio3"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/resolver"
)

const (
	defaultFlushInterval = 250 * time.Millisecond
	defaultTeardownDelay = 30 * time.Second
	defaultMinBackoff    = time.Second
	defaultMaxBackoff    = time.Minute
	maxBatch             = 200 // abnormal-burst cap per flush (as in flush.py)
	subscriberBuffer     = 64  // queued batches per widget before dropping (64 × 250 ms = 16 s)

	// Widget streams are unauthenticated (channel ids are public), so cap them:
	// a streamer needs a handful (OBS + preview), not hundreds.
	defaultMaxPerChannel = 10
	defaultMaxTotal      = 1000
)

var (
	ErrClosed             = errors.New("realtime: hub closed")
	ErrTooManySubscribers = errors.New("realtime: too many widget connections")
)

type TokenSource interface {
	AccessToken(ctx context.Context, channelID string) (string, error)
}

// SessionAPI is the part of the Chzzk client the worker needs.
type SessionAPI interface {
	UserSessionURL(ctx context.Context, accessToken string) (string, error)
	SubscribeChat(ctx context.Context, accessToken, sessionKey string) error
}

type Socket interface {
	Run(ctx context.Context, handle func(eio3.Event)) error
	Close() error
}

type Dialer func(ctx context.Context, sessionURL string) (Socket, error)

type Resolver interface {
	Resolve(ctx context.Context, senderChannelID string) (resolver.Result, error)
}

type Config struct {
	Tokens   TokenSource
	API      SessionAPI
	Dial     Dialer // nil = eio3.Dial with a 10 s timeout
	Resolver Resolver
	Logger   *slog.Logger // nil = slog.Default()

	// Zero values mean the production defaults; tests shorten them.
	FlushInterval time.Duration
	TeardownDelay time.Duration
	MinBackoff    time.Duration
	MaxBackoff    time.Duration
	MaxPerChannel int // subscribers per channel
	MaxTotal      int // subscribers across all channels
}

type Hub struct {
	cfg    Config
	log    *slog.Logger
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
	nextID atomic.Int64 // message ids, unique per process

	mu       sync.Mutex
	closed   bool
	channels map[string]*channel
	total    int // subscribers across all channels
}

type channel struct {
	id     string
	cancel context.CancelFunc

	// Guarded by Hub.mu.
	subs     map[*Subscription]struct{}
	teardown *time.Timer

	bufMu  sync.Mutex
	buffer []ChatMessage
}

// Subscription receives pre-encoded SSE "chat" event payloads (JSON). C is
// closed when the hub shuts down.
type Subscription struct {
	C  <-chan []byte
	c  chan []byte
	ch *channel
}

func New(cfg Config) *Hub {
	if cfg.Dial == nil {
		cfg.Dial = func(ctx context.Context, url string) (Socket, error) {
			ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			return eio3.Dial(ctx, url, eio3.Options{})
		}
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	cfg.FlushInterval = or0(cfg.FlushInterval, defaultFlushInterval)
	cfg.TeardownDelay = or0(cfg.TeardownDelay, defaultTeardownDelay)
	cfg.MinBackoff = or0(cfg.MinBackoff, defaultMinBackoff)
	cfg.MaxBackoff = or0(cfg.MaxBackoff, defaultMaxBackoff)
	if cfg.MaxPerChannel == 0 {
		cfg.MaxPerChannel = defaultMaxPerChannel
	}
	if cfg.MaxTotal == 0 {
		cfg.MaxTotal = defaultMaxTotal
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Hub{cfg: cfg, log: cfg.Logger, ctx: ctx, cancel: cancel, channels: map[string]*channel{}}
}

func or0(v, def time.Duration) time.Duration {
	if v == 0 {
		return def
	}
	return v
}

// Subscribe registers a widget for channelID, starting the channel's worker if
// needed and cancelling a pending teardown.
func (h *Hub) Subscribe(channelID string) (*Subscription, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, ErrClosed
	}
	ch, ok := h.channels[channelID]
	if h.total >= h.cfg.MaxTotal || (ok && len(ch.subs) >= h.cfg.MaxPerChannel) {
		return nil, ErrTooManySubscribers
	}
	if !ok {
		ch = h.startChannel(channelID)
		h.channels[channelID] = ch
	}
	if ch.teardown != nil {
		ch.teardown.Stop()
		ch.teardown = nil
	}
	c := make(chan []byte, subscriberBuffer)
	sub := &Subscription{C: c, c: c, ch: ch}
	ch.subs[sub] = struct{}{}
	h.total++
	return sub, nil
}

// Unsubscribe removes a widget; the last one arms the teardown timer.
func (h *Hub) Unsubscribe(sub *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := sub.ch
	if _, ok := ch.subs[sub]; !ok {
		return
	}
	delete(ch.subs, sub)
	h.total--
	if len(ch.subs) > 0 || h.closed {
		return
	}
	ch.teardown = time.AfterFunc(h.cfg.TeardownDelay, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		// Re-check: a Subscribe may have raced the timer.
		if len(ch.subs) == 0 && h.channels[ch.id] == ch {
			delete(h.channels, ch.id)
			ch.cancel()
			h.log.Info("channel torn down", "channel", ch.id)
		}
	})
}

// Inject queues a chat message for channelID as if it came from Chzzk (only
// for the dev-mode test endpoint). It is a no-op if the channel is not active.
func (h *Hub) Inject(channelID string, m ChatMessage) bool {
	h.mu.Lock()
	ch, ok := h.channels[channelID]
	h.mu.Unlock()
	if ok {
		ch.push(m)
	}
	return ok
}

// Close stops every worker and then closes all subscription channels, which
// ends the SSE handlers. Safe to call more than once.
func (h *Hub) Close() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return
	}
	h.closed = true
	var subs []*Subscription
	for _, ch := range h.channels {
		if ch.teardown != nil {
			ch.teardown.Stop()
		}
		for sub := range ch.subs {
			subs = append(subs, sub)
		}
		ch.subs = map[*Subscription]struct{}{}
	}
	h.channels = map[string]*channel{}
	h.total = 0
	h.mu.Unlock()

	h.cancel()  // stops every worker (their contexts derive from h.ctx)
	h.wg.Wait() // no flush can be sending after this...
	for _, sub := range subs {
		close(sub.c) // ...so closing is safe
	}
}

// startChannel must be called with h.mu held.
func (h *Hub) startChannel(id string) *channel {
	ctx, cancel := context.WithCancel(h.ctx)
	ch := &channel{id: id, cancel: cancel, subs: map[*Subscription]struct{}{}}
	log := h.log.With("channel", id)
	h.wg.Add(2)
	go func() { defer h.wg.Done(); h.ingest(ctx, ch, log) }()
	go func() { defer h.wg.Done(); h.flushLoop(ctx, ch, log) }()
	log.Info("channel started")
	return ch
}

func (ch *channel) push(m ChatMessage) {
	ch.bufMu.Lock()
	ch.buffer = append(ch.buffer, m)
	ch.bufMu.Unlock()
}

func (ch *channel) drain() []ChatMessage {
	ch.bufMu.Lock()
	defer ch.bufMu.Unlock()
	b := ch.buffer
	ch.buffer = nil
	return b
}

func (h *Hub) subscribers(ch *channel) []*Subscription {
	h.mu.Lock()
	defer h.mu.Unlock()
	subs := make([]*Subscription, 0, len(ch.subs))
	for s := range ch.subs {
		subs = append(subs, s)
	}
	return subs
}

func (h *Hub) flushLoop(ctx context.Context, ch *channel, log *slog.Logger) {
	t := time.NewTicker(h.cfg.FlushInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.flushOnce(ctx, ch, log)
		}
	}
}

// BatchMessage is one chat line of an SSE "chat" event (same JSON as flush.py).
type BatchMessage struct {
	ID       int64             `json:"id"`
	Text     string            `json:"text"`
	Emojis   map[string]string `json:"emojis"`
	Status   resolver.Status   `json:"status"`
	Badge    *resolver.Badges  `json:"badge"`
	Nickname string            `json:"nickname"`
}

type batchPayload struct {
	Messages []BatchMessage `json:"messages"`
}

func (h *Hub) flushOnce(ctx context.Context, ch *channel, log *slog.Logger) {
	raw := ch.drain()
	if len(raw) == 0 {
		return
	}
	subs := h.subscribers(ch)
	if len(subs) == 0 {
		return // nobody listening: drop
	}
	data, err := json.Marshal(h.buildBatch(ctx, raw, log))
	if err != nil {
		log.Error("encode batch", "err", err)
		return
	}
	for _, s := range subs {
		select {
		case s.c <- data:
		default: // a stuck widget must not block the others
		}
	}
}

// buildBatch resolves each sender once per batch. A DB error degrades that
// sender to "unlinked" for this batch rather than dropping the messages.
func (h *Hub) buildBatch(ctx context.Context, raw []ChatMessage, log *slog.Logger) batchPayload {
	if len(raw) > maxBatch {
		raw = raw[:maxBatch]
	}
	seen := map[string]resolver.Result{}
	msgs := make([]BatchMessage, 0, len(raw))
	for _, m := range raw {
		res, ok := seen[m.SenderChannelID]
		if !ok {
			var err error
			if res, err = h.cfg.Resolver.Resolve(ctx, m.SenderChannelID); err != nil {
				log.Error("resolve sender", "err", err)
				res = resolver.Result{Status: resolver.Unlinked}
			}
			seen[m.SenderChannelID] = res
		}
		emojis := m.Emojis
		if emojis == nil {
			emojis = map[string]string{} // always an object, never null
		}
		msgs = append(msgs, BatchMessage{
			ID:       h.nextID.Add(1),
			Text:     m.Content,
			Emojis:   emojis,
			Status:   res.Status,
			Badge:    res.Badge,
			Nickname: m.Nickname,
		})
	}
	return batchPayload{Messages: msgs}
}

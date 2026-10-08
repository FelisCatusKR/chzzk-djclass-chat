package realtime

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk/eio3"
)

// A session that stayed up this long counts as healthy and resets the backoff.
const healthyAfter = time.Minute

const subscribeAttempts = 3

// ingest keeps one Chzzk session open for ch until ctx ends. Every attempt
// starts from scratch — token (refreshed if near expiry) → fresh session URL
// (they are single-use) → dial → SYSTEM "connected" → subscribe → CHAT into the
// buffer. Any failure, including a normal server-side close, waits a backoff
// that doubles up to MaxBackoff and tries again; nothing is retried "once".
func (h *Hub) ingest(ctx context.Context, ch *channel, log *slog.Logger) {
	backoff := h.cfg.MinBackoff
	for ctx.Err() == nil {
		began := time.Now()
		err := h.session(ctx, ch, log)
		if ctx.Err() != nil {
			return
		}
		if time.Since(began) >= healthyAfter {
			backoff = h.cfg.MinBackoff
		}
		level := slog.LevelWarn
		if errors.Is(err, eio3.ErrServerClosed) {
			level = slog.LevelInfo // Chzzk closes long sessions on its own
		}
		log.Log(ctx, level, "chat session ended", "err", err, "retry_in", backoff)
		sleep(ctx, backoff)
		backoff = min(backoff*2, h.cfg.MaxBackoff)
	}
}

func (h *Hub) session(ctx context.Context, ch *channel, log *slog.Logger) error {
	token, err := h.cfg.Tokens.AccessToken(ctx, ch.id)
	if err != nil {
		return err
	}
	url, err := h.cfg.API.UserSessionURL(ctx, token)
	if err != nil {
		return fmt.Errorf("session url: %w", err)
	}
	sock, err := h.cfg.Dial(ctx, url)
	if err != nil {
		return err
	}
	defer sock.Close()
	log.Info("chat socket connected")

	sctx, fail := context.WithCancelCause(ctx)
	defer fail(nil)
	err = sock.Run(sctx, func(ev eio3.Event) {
		var data map[string]any
		if len(ev.Args) > 0 {
			data = eio3.DecodeArg(ev.Args[0])
		}
		switch ev.Name {
		case "CHAT":
			ch.push(ExtractChat(data, ch.id))
		case "SYSTEM":
			switch data["type"] {
			case "connected":
				inner, _ := data["data"].(map[string]any)
				key, _ := inner["sessionKey"].(string)
				if key == "" {
					fail(errors.New("SYSTEM connected without sessionKey"))
					return
				}
				// Off the read loop so pings keep flowing while we call the API.
				go h.subscribe(sctx, fail, token, key, log)
			case "subscribed":
				log.Info("chat subscription confirmed")
			}
		case "error": // e.g. "auth fail"; the server disconnects right after
			var detail string
			if len(ev.Args) > 0 {
				detail = string(ev.Args[0])
			}
			log.Warn("chat socket error event", "detail", detail)
		}
	})
	if cause := context.Cause(sctx); cause != nil && ctx.Err() == nil {
		return cause // our own fail(): subscribe gave up, or no sessionKey
	}
	return err
}

// subscribe binds the session to this channel's CHAT events, retrying a few
// times; if it keeps failing the whole session is restarted (fresh URL),
// instead of sitting connected with no chat.
func (h *Hub) subscribe(ctx context.Context, fail context.CancelCauseFunc, token, key string, log *slog.Logger) {
	for attempt := 1; ; attempt++ {
		err := h.cfg.API.SubscribeChat(ctx, token, key)
		if err == nil || ctx.Err() != nil {
			return
		}
		if attempt == subscribeAttempts {
			fail(fmt.Errorf("subscribe chat: %w", err))
			return
		}
		log.Warn("subscribe chat failed, retrying", "attempt", attempt, "err", err)
		sleep(ctx, time.Duration(attempt)*h.cfg.MinBackoff)
	}
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

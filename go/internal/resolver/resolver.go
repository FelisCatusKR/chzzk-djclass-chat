// Package resolver turns a chat sender into the badge status the widget shows
// (port of djclass/resolver.py). Results are cached per sender with a TTL that
// depends on the status, so active chatters don't hit the DB on every flush.
package resolver

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/djclass"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/ttlcache"
)

type Status string

const (
	Linked   Status = "linked"   // V-ARCHIVE linked and synced
	Unsynced Status = "unsynced" // linked, no DJ CLASS rows yet
	Unlinked Status = "unlinked" // unknown user or no active link (미인증)
)

var ttl = map[Status]time.Duration{
	Linked:   5 * time.Minute,
	Unsynced: 15 * time.Second,
	Unlinked: 10 * time.Second,
}

// Badges carries both selections; the widget picks one per its display mode.
type Badges struct {
	Auto   djclass.Badge `json:"auto"`
	Viewer djclass.Badge `json:"viewer"`
}

type Result struct {
	Status Status  `json:"status"`
	Badge  *Badges `json:"badge"` // nil unless Linked
}

type Resolver struct {
	q     *db.Queries
	cache *ttlcache.Cache[Result]
}

// New resolves through q (the store's read pool).
func New(q *db.Queries) *Resolver {
	return &Resolver{q: q, cache: ttlcache.New[Result](10000, nil)}
}

func cacheKey(senderChannelID, nickname string) string {
	if senderChannelID != "" {
		return "id:" + senderChannelID
	}
	return "nick:" + nickname
}

// Resolve looks the sender up by Chzzk channel id, falling back to nickname.
// DB errors are returned and not cached.
func (r *Resolver) Resolve(ctx context.Context, senderChannelID, nickname string) (Result, error) {
	key := cacheKey(senderChannelID, nickname)
	if res, ok := r.cache.Get(key); ok {
		return res, nil
	}
	res, err := r.resolve(ctx, senderChannelID, nickname)
	if err != nil {
		return Result{}, err
	}
	r.cache.Set(key, res, ttl[res.Status])
	return res, nil
}

func (r *Resolver) resolve(ctx context.Context, senderChannelID, nickname string) (Result, error) {
	unlinked := Result{Status: Unlinked}
	user, err := r.findUser(ctx, senderChannelID, nickname)
	if errors.Is(err, sql.ErrNoRows) {
		return unlinked, nil
	}
	if err != nil {
		return Result{}, err
	}
	linked, err := r.q.HasActiveLink(ctx, user.ID)
	if err != nil {
		return Result{}, err
	}
	if !linked {
		return unlinked, nil
	}
	stored, err := r.q.ListDjClasses(ctx, user.ID)
	if err != nil {
		return Result{}, err
	}
	rows := make([]djclass.Row, len(stored))
	for i, s := range stored {
		rows[i] = djclass.Row{Button: int(s.Button), Class: s.DjClass, Conversion: s.DjPowerConversion}
	}
	auto, ok := djclass.Resolve(rows, nil, djclass.Auto)
	if !ok {
		return Result{Status: Unsynced}, nil
	}
	var preferred *int
	if user.PreferredButton != nil {
		p := int(*user.PreferredButton)
		preferred = &p
	}
	viewer, _ := djclass.Resolve(rows, preferred, djclass.Viewer) // non-empty rows: always ok
	return Result{Status: Linked, Badge: &Badges{
		Auto:   djclass.BuildBadge(auto),
		Viewer: djclass.BuildBadge(viewer),
	}}, nil
}

func (r *Resolver) findUser(ctx context.Context, senderChannelID, nickname string) (db.User, error) {
	if senderChannelID != "" {
		u, err := r.q.GetUserByChzzkID(ctx, senderChannelID)
		if !errors.Is(err, sql.ErrNoRows) {
			return u, err
		}
	}
	if nickname != "" {
		return r.q.GetUserByNickname(ctx, nickname)
	}
	return db.User{}, sql.ErrNoRows
}

// InvalidateUser drops the cached result under both keys a user's chats can
// map to. Call it after any committed link / sync / unlink / preference change.
func (r *Resolver) InvalidateUser(chzzkID, nickname string) {
	r.cache.Delete("id:" + chzzkID)
	r.cache.Delete("nick:" + nickname)
}

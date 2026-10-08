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

// Resolve looks the sender up by Chzzk channel id only. There is deliberately
// no nickname fallback (the Django version had one): nicknames are not unique
// and anyone can change theirs, so matching on them let a viewer wear a linked
// user's badge. No id → unlinked. DB errors are returned and not cached.
func (r *Resolver) Resolve(ctx context.Context, senderChannelID string) (Result, error) {
	if senderChannelID == "" {
		return Result{Status: Unlinked}, nil
	}
	if res, ok := r.cache.Get(senderChannelID); ok {
		return res, nil
	}
	res, err := r.resolve(ctx, senderChannelID)
	if err != nil {
		return Result{}, err
	}
	r.cache.Set(senderChannelID, res, ttl[res.Status])
	return res, nil
}

func (r *Resolver) resolve(ctx context.Context, senderChannelID string) (Result, error) {
	unlinked := Result{Status: Unlinked}
	user, err := r.q.GetUserByChzzkID(ctx, senderChannelID)
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

// InvalidateUser drops a user's cached result. Call it after any committed
// link / sync / unlink / preference change.
func (r *Resolver) InvalidateUser(chzzkID string) {
	r.cache.Delete(chzzkID)
}

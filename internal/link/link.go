// Package link is the viewer side: linking a Chzzk account to V-ARCHIVE,
// syncing DJ CLASS, unlinking, the preferred button, and the daily sync of
// every active link (port of viewers/views.py + djclass/sync.py).
//
// Rule for every method: V-ARCHIVE calls happen outside any write
// transaction, and the badge cache is invalidated only after the commit.
package link

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/djclass"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/varchive"
)

var (
	ErrNotLinked     = errors.New("link: no active V-ARCHIVE link")
	ErrInvalidButton = errors.New("link: invalid preferred button")
)

type VArchive interface {
	LookupUser(ctx context.Context, token string) (varchive.User, error)
	AllDjClasses(ctx context.Context, nickname string) []varchive.DjClass
}

// Invalidator drops a user's cached badge (resolver.Resolver).
type Invalidator interface {
	InvalidateUser(chzzkID string)
}

type Service struct {
	Store *store.Store
	VA    VArchive
	Cache Invalidator
	Log   *slog.Logger
}

type SyncResult struct {
	OK bool
	// Stale: the fetch came back empty although the user had classes before —
	// most likely their V-ARCHIVE nickname changed. Existing rows are kept.
	Stale   bool
	Highest *djclass.Row // set when OK
}

// Connect verifies the 조회토큰 (used once, never stored), saves the link and
// runs the first sync. Errors: varchive.ErrInvalidToken / ErrUnavailable.
func (s *Service) Connect(ctx context.Context, u db.User, token string) (SyncResult, error) {
	va, err := s.VA.LookupUser(ctx, token)
	if err != nil {
		return SyncResult{}, err
	}
	err = s.Store.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.UpsertVarchiveLink(ctx, db.UpsertVarchiveLinkParams{
			UserID: u.ID, VarchiveNickname: va.Nickname, VarchiveUserNo: &va.UserNo,
		})
	})
	if err != nil {
		return SyncResult{}, err
	}
	s.Cache.InvalidateUser(u.ChzzkID)
	return s.syncUser(ctx, u, va.Nickname)
}

// Sync re-fetches the user's DJ CLASS by their linked V-ARCHIVE nickname.
func (s *Service) Sync(ctx context.Context, u db.User) (SyncResult, error) {
	l, err := s.Store.Read.GetActiveLink(ctx, u.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return SyncResult{}, ErrNotLinked
	}
	if err != nil {
		return SyncResult{}, err
	}
	return s.syncUser(ctx, u, l.VarchiveNickname)
}

// syncUser replaces the user's rows with V-ARCHIVE's current classes. An empty
// fetch keeps existing rows (a transient outage must not wipe good data).
func (s *Service) syncUser(ctx context.Context, u db.User, nickname string) (SyncResult, error) {
	classes := s.VA.AllDjClasses(ctx, nickname)
	if len(classes) == 0 {
		had, err := s.Store.Read.ListDjClasses(ctx, u.ID)
		if err != nil {
			return SyncResult{}, err
		}
		return SyncResult{Stale: len(had) > 0}, nil
	}
	err := s.Store.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		if err := q.DeleteDjClasses(ctx, u.ID); err != nil {
			return err
		}
		for _, c := range classes {
			err := q.UpsertDjClass(ctx, db.UpsertDjClassParams{
				UserID: u.ID, Button: int64(c.Button), DjClass: c.Class,
				DjPowerSum: c.PowerSum, MaxDjPower: c.MaxPower, DjPowerConversion: c.PowerConversion,
			})
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return SyncResult{}, err
	}
	s.Cache.InvalidateUser(u.ChzzkID)

	rows := make([]djclass.Row, len(classes))
	for i, c := range classes {
		rows[i] = djclass.Row{Button: c.Button, Class: c.Class, Conversion: c.PowerConversion}
	}
	best, _ := djclass.Resolve(rows, nil, djclass.Auto)
	return SyncResult{OK: true, Highest: &best}, nil
}

// Unlink deactivates the link and clears classes and the preferred button.
// A no-op for users without an active link.
func (s *Service) Unlink(ctx context.Context, u db.User) error {
	if _, err := s.Store.Read.GetActiveLink(ctx, u.ID); errors.Is(err, sql.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	err := s.Store.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		if err := q.DeactivateLink(ctx, u.ID); err != nil {
			return err
		}
		if err := q.DeleteDjClasses(ctx, u.ID); err != nil {
			return err
		}
		return q.SetPreferredButton(ctx, db.SetPreferredButtonParams{PreferredButton: nil, ID: u.ID})
	})
	if err != nil {
		return err
	}
	s.Cache.InvalidateUser(u.ChzzkID)
	return nil
}

// SetPreferredButton stores "auto"/"" as nil, or a button the user has a class
// for. Anything else is ErrInvalidButton.
func (s *Service) SetPreferredButton(ctx context.Context, u db.User, raw string) error {
	var pref *int64
	if raw != "" && raw != "auto" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return ErrInvalidButton
		}
		rows, err := s.Store.Read.ListDjClasses(ctx, u.ID)
		if err != nil {
			return err
		}
		if !slices.ContainsFunc(rows, func(r db.DjClass) bool { return r.Button == n }) {
			return ErrInvalidButton
		}
		pref = &n
	}
	err := s.Store.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.SetPreferredButton(ctx, db.SetPreferredButtonParams{PreferredButton: pref, ID: u.ID})
	})
	if err != nil {
		return err
	}
	s.Cache.InvalidateUser(u.ChzzkID)
	return nil
}

// SyncAll syncs every active link in turn; one bad link never stops the batch.
func (s *Service) SyncAll(ctx context.Context) (success, failed int) {
	links, err := s.Store.Read.ListActiveLinks(ctx)
	if err != nil {
		s.Log.Error("sync all: list links", "err", err)
		return 0, 0
	}
	for _, l := range links {
		if ctx.Err() != nil {
			break
		}
		u := db.User{ID: l.UserID, ChzzkID: l.ChzzkID, ChzzkNickname: l.ChzzkNickname}
		res, err := s.syncUser(ctx, u, l.VarchiveNickname)
		switch {
		case err != nil:
			failed++
			s.Log.Error("sync all: user failed", "user", l.UserID, "err", err)
		case !res.OK:
			failed++
			s.Log.Warn("sync all: no data", "user", l.UserID, "stale", res.Stale)
		default:
			success++
		}
	}
	return success, failed
}

// Option is one preferred-button choice on /link (auto + one per button).
type Option struct {
	Label, Value string
	Badge        djclass.Badge
	Checked      bool
}

// Card is the state of the /link card.
type Card struct {
	Linked           bool
	VarchiveNickname string
	Options          []Option
}

func (s *Service) Card(ctx context.Context, u db.User) (Card, error) {
	l, err := s.Store.Read.GetActiveLink(ctx, u.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return Card{}, nil
	}
	if err != nil {
		return Card{}, err
	}
	card := Card{Linked: true, VarchiveNickname: l.VarchiveNickname}
	stored, err := s.Store.Read.ListDjClasses(ctx, u.ID) // ordered by button
	if err != nil || len(stored) == 0 {
		return card, err
	}
	rows := make([]djclass.Row, len(stored))
	for i, r := range stored {
		rows[i] = djclass.Row{Button: int(r.Button), Class: r.DjClass, Conversion: r.DjPowerConversion}
	}
	auto, _ := djclass.Resolve(rows, nil, djclass.Auto)
	card.Options = append(card.Options, Option{
		Label: "자동 (최고 클래스)", Value: "auto", Badge: djclass.BuildBadge(auto), Checked: u.PreferredButton == nil,
	})
	for _, r := range rows {
		card.Options = append(card.Options, Option{
			Label:   fmt.Sprintf("%d버튼", r.Button),
			Value:   strconv.Itoa(r.Button),
			Badge:   djclass.BuildBadge(r),
			Checked: u.PreferredButton != nil && int(*u.PreferredButton) == r.Button,
		})
	}
	return card, nil
}

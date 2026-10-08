package link

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/varchive"
)

// Ported from djclass/tests/test_sync.py and viewers/tests/test_link_actions.py.

func f(v float64) *float64 { return &v }

var classes = []varchive.DjClass{
	{Button: 4, Class: "SHOWSTOPPER II", PowerSum: f(1), MaxPower: f(2), PowerConversion: f(9823)},
	{Button: 8, Class: "HEADLINER IV", PowerSum: f(3), MaxPower: f(4), PowerConversion: f(9410)},
}

type fakeVA struct {
	user    varchive.User
	userErr error
	classes map[string][]varchive.DjClass
}

func (f *fakeVA) LookupUser(context.Context, string) (varchive.User, error) { return f.user, f.userErr }
func (f *fakeVA) AllDjClasses(_ context.Context, nick string) []varchive.DjClass {
	return f.classes[nick]
}

type fakeCache struct{ invalidated []string }

func (c *fakeCache) InvalidateUser(id string) { c.invalidated = append(c.invalidated, id) }

func setup(t *testing.T) (*Service, *fakeVA, *fakeCache, db.User) {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "t.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	var u db.User
	err = st.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		u, err = q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c1", ChzzkNickname: "Viewer"})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	va := &fakeVA{user: varchive.User{UserNo: 7, Nickname: "VA"}, classes: map[string][]varchive.DjClass{"VA": classes}}
	cache := &fakeCache{}
	return &Service{Store: st, VA: va, Cache: cache, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}, va, cache, u
}

func buttons(t *testing.T, s *Service, userID int64) []int64 {
	t.Helper()
	rows, err := s.Store.Read.ListDjClasses(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	var out []int64
	for _, r := range rows {
		out = append(out, r.Button)
	}
	return out
}

func TestConnectLinksAndSyncs(t *testing.T) {
	s, _, cache, u := setup(t)
	ctx := context.Background()
	res, err := s.Connect(ctx, u, "tok")
	if err != nil || !res.OK || res.Highest.Button != 4 { // SS II outranks HL IV
		t.Fatalf("Connect = %+v, %v", res, err)
	}
	l, err := s.Store.Read.GetActiveLink(ctx, u.ID)
	if err != nil || l.VarchiveNickname != "VA" || *l.VarchiveUserNo != 7 {
		t.Errorf("link = %+v, %v", l, err)
	}
	if got := buttons(t, s, u.ID); len(got) != 2 {
		t.Errorf("buttons = %v", got)
	}
	if len(cache.invalidated) == 0 {
		t.Error("cache not invalidated")
	}
}

func TestConnectInvalidTokenSavesNothing(t *testing.T) {
	s, va, _, u := setup(t)
	va.userErr = varchive.ErrInvalidToken
	if _, err := s.Connect(context.Background(), u, "bad"); !errors.Is(err, varchive.ErrInvalidToken) {
		t.Fatalf("err = %v", err)
	}
	if _, err := s.Store.Read.GetActiveLink(context.Background(), u.ID); err == nil {
		t.Error("link saved for an invalid token")
	}
}

func TestSyncReplacesRowsAndKeepsThemOnEmptyFetch(t *testing.T) {
	s, va, _, u := setup(t)
	ctx := context.Background()
	if _, err := s.Sync(ctx, u); !errors.Is(err, ErrNotLinked) {
		t.Fatalf("unlinked Sync = %v", err)
	}
	s.Connect(ctx, u, "tok")

	// Stale button 8 disappears, 6 appears.
	va.classes["VA"] = []varchive.DjClass{{Button: 4, Class: "BEAT MAESTRO I"}, {Button: 6, Class: "ROOKIE I"}}
	res, err := s.Sync(ctx, u)
	if err != nil || !res.OK || res.Highest.Class != "BEAT MAESTRO I" {
		t.Fatalf("Sync = %+v, %v", res, err)
	}
	if got := buttons(t, s, u.ID); len(got) != 2 || got[0] != 4 || got[1] != 6 {
		t.Errorf("buttons = %v, want [4 6]", got)
	}

	// Empty fetch (nickname changed / outage): rows kept, flagged stale.
	va.classes["VA"] = nil
	res, err = s.Sync(ctx, u)
	if err != nil || res.OK || !res.Stale {
		t.Errorf("empty Sync = %+v, %v", res, err)
	}
	if got := buttons(t, s, u.ID); len(got) != 2 {
		t.Errorf("rows wiped on empty fetch: %v", got)
	}
}

func TestUnlinkClearsEverything(t *testing.T) {
	s, _, _, u := setup(t)
	ctx := context.Background()
	if err := s.Unlink(ctx, u); err != nil { // not linked: no-op
		t.Fatal(err)
	}
	s.Connect(ctx, u, "tok")
	s.SetPreferredButton(ctx, u, "8")
	if err := s.Unlink(ctx, u); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Store.Read.GetActiveLink(ctx, u.ID); err == nil {
		t.Error("link still active")
	}
	if got := buttons(t, s, u.ID); len(got) != 0 {
		t.Errorf("classes left: %v", got)
	}
	if got, _ := s.Store.Read.GetUserByID(ctx, u.ID); got.PreferredButton != nil {
		t.Errorf("preferred button left: %v", *got.PreferredButton)
	}
}

func TestSetPreferredButton(t *testing.T) {
	s, _, _, u := setup(t)
	ctx := context.Background()
	s.Connect(ctx, u, "tok")
	if err := s.SetPreferredButton(ctx, u, "8"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Store.Read.GetUserByID(ctx, u.ID); got.PreferredButton == nil || *got.PreferredButton != 8 {
		t.Errorf("preferred = %v", got.PreferredButton)
	}
	for _, bad := range []string{"5", "x", "7", "-1"} { // 5: no class for it
		if err := s.SetPreferredButton(ctx, u, bad); !errors.Is(err, ErrInvalidButton) {
			t.Errorf("%q: err = %v", bad, err)
		}
	}
	if err := s.SetPreferredButton(ctx, u, "auto"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Store.Read.GetUserByID(ctx, u.ID); got.PreferredButton != nil {
		t.Errorf("auto did not clear: %v", *got.PreferredButton)
	}
}

func TestCard(t *testing.T) {
	s, _, _, u := setup(t)
	ctx := context.Background()
	if c, err := s.Card(ctx, u); err != nil || c.Linked || len(c.Options) != 0 {
		t.Fatalf("unlinked card = %+v, %v", c, err)
	}
	s.Connect(ctx, u, "tok")
	s.SetPreferredButton(ctx, u, "8")
	u, _ = s.Store.Read.GetUserByID(ctx, u.ID)
	c, err := s.Card(ctx, u)
	if err != nil || !c.Linked || c.VarchiveNickname != "VA" || len(c.Options) != 3 {
		t.Fatalf("card = %+v, %v", c, err)
	}
	if c.Options[0].Value != "auto" || c.Options[0].Badge.Class != "SS II" || c.Options[0].Checked {
		t.Errorf("auto option = %+v", c.Options[0])
	}
	if c.Options[2].Label != "8버튼" || !c.Options[2].Checked {
		t.Errorf("8B option = %+v", c.Options[2])
	}
}

func TestSyncAllIsolatesFailures(t *testing.T) {
	s, va, _, u := setup(t)
	ctx := context.Background()
	s.Connect(ctx, u, "tok")
	var u2, u3 db.User
	s.Store.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		u2, _ = q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c2", ChzzkNickname: "B"})
		u3, _ = q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c3", ChzzkNickname: "C"})
		q.UpsertVarchiveLink(ctx, db.UpsertVarchiveLinkParams{UserID: u2.ID, VarchiveNickname: "gone"})
		return q.UpsertVarchiveLink(ctx, db.UpsertVarchiveLinkParams{UserID: u3.ID, VarchiveNickname: "VA"})
	})
	s.Unlink(ctx, u3) // inactive: skipped
	va.classes["VA"] = classes[:1]
	if ok, bad := s.SyncAll(ctx); ok != 1 || bad != 1 {
		t.Errorf("SyncAll = (%d, %d), want (1, 1)", ok, bad)
	}
	if got := buttons(t, s, u.ID); len(got) != 1 {
		t.Errorf("u1 not re-synced: %v", got)
	}
}

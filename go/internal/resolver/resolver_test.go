package resolver

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
)

// Ported from djclass_overlay/djclass/tests/test_resolver.py.

func setup(t *testing.T) (*store.Store, *Resolver) {
	t.Helper()
	s, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, New(s.Read)
}

func exec(t *testing.T, s *store.Store, query string, args ...any) {
	t.Helper()
	if _, err := s.WriteDB().Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func resolve(t *testing.T, r *Resolver, id, nick string) Result {
	t.Helper()
	res, err := r.Resolve(context.Background(), id, nick)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestUnlinkedWhenNoUser(t *testing.T) {
	_, r := setup(t)
	if res := resolve(t, r, "nobody", "Ghost"); res.Status != Unlinked || res.Badge != nil {
		t.Errorf("got %+v", res)
	}
}

func TestUnlinkedWithoutActiveLink(t *testing.T) {
	s, r := setup(t)
	exec(t, s, `INSERT INTO users (id, chzzk_id, chzzk_nickname) VALUES (1, 'c1', 'N')`)
	exec(t, s, `INSERT INTO varchive_links (user_id, varchive_nickname, is_active) VALUES (1, 'v', 0)`)
	if res := resolve(t, r, "c1", "N"); res.Status != Unlinked {
		t.Errorf("got %+v", res)
	}
}

func TestUnsyncedWhenLinkedWithoutRows(t *testing.T) {
	s, r := setup(t)
	exec(t, s, `INSERT INTO users (id, chzzk_id, chzzk_nickname) VALUES (1, 'c2', 'N')`)
	exec(t, s, `INSERT INTO varchive_links (user_id, varchive_nickname) VALUES (1, 'v')`)
	if res := resolve(t, r, "c2", "N"); res.Status != Unsynced || res.Badge != nil {
		t.Errorf("got %+v", res)
	}
}

func TestLinkedEmitsAutoAndViewer(t *testing.T) {
	s, r := setup(t)
	exec(t, s, `INSERT INTO users (id, chzzk_id, chzzk_nickname, preferred_button) VALUES (1, 'c3', 'N', 8)`)
	exec(t, s, `INSERT INTO varchive_links (user_id, varchive_nickname) VALUES (1, 'v')`)
	exec(t, s, `INSERT INTO dj_classes (user_id, button, dj_class, dj_power_conversion) VALUES (1, 4, 'SHOWSTOPPER II', 9810), (1, 8, 'HEADLINER I', 9660)`)
	res := resolve(t, r, "c3", "N")
	if res.Status != Linked || res.Badge == nil {
		t.Fatalf("got %+v", res)
	}
	if res.Badge.Auto.Class != "SS II" {
		t.Errorf("auto = %+v, want highest class SS II", res.Badge.Auto)
	}
	if res.Badge.Viewer.Button != 8 {
		t.Errorf("viewer = %+v, want preferred button 8", res.Badge.Viewer)
	}
}

func TestNicknameFallback(t *testing.T) {
	s, r := setup(t)
	exec(t, s, `INSERT INTO users (id, chzzk_id, chzzk_nickname) VALUES (1, 'c5', 'Nick')`)
	exec(t, s, `INSERT INTO varchive_links (user_id, varchive_nickname) VALUES (1, 'v')`)
	if res := resolve(t, r, "", "Nick"); res.Status != Unsynced {
		t.Errorf("no sender id: got %+v", res)
	}
	// An unknown sender id still falls back to the nickname (as in Python).
	if res := resolve(t, r, "other-id", "Nick"); res.Status != Unsynced {
		t.Errorf("unknown id: got %+v", res)
	}
}

func TestCachedUntilInvalidated(t *testing.T) {
	s, r := setup(t)
	exec(t, s, `INSERT INTO users (id, chzzk_id, chzzk_nickname) VALUES (1, 'c4', 'N')`)
	exec(t, s, `INSERT INTO varchive_links (user_id, varchive_nickname) VALUES (1, 'v')`)
	exec(t, s, `INSERT INTO dj_classes (user_id, button, dj_class, dj_power_conversion) VALUES (1, 4, 'ROOKIE I', 4900)`)
	first := resolve(t, r, "c4", "N")

	// Change the DB behind the cache: the cached result is still served.
	exec(t, s, `UPDATE dj_classes SET dj_class = 'SHOWSTOPPER II' WHERE user_id = 1`)
	if again := resolve(t, r, "c4", "N"); again.Badge.Auto.Class != first.Badge.Auto.Class {
		t.Errorf("cache miss: %+v", again)
	}
	r.InvalidateUser("c4", "N")
	if fresh := resolve(t, r, "c4", "N"); fresh.Badge.Auto.Class != "SS II" {
		t.Errorf("after invalidate: %+v", fresh)
	}
}

func TestTTLByStatus(t *testing.T) {
	for status, want := range map[Status]string{Linked: "5m0s", Unsynced: "15s", Unlinked: "10s"} {
		if got := ttl[status].String(); got != want {
			t.Errorf("ttl[%s] = %s, want %s", status, got, want)
		}
	}
}

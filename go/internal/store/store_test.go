package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// mustExec runs raw SQL on the write connection (outside any WriteTx).
func mustExec(t *testing.T, s *Store, query string, args ...any) {
	t.Helper()
	if _, err := s.WriteDB().Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestOpenIsIdempotentAndUsesWAL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.sqlite3")
	for range 2 { // second open: migrations already applied
		s, err := Open(context.Background(), path)
		if err != nil {
			t.Fatal(err)
		}
		var mode string
		if err := s.ReadDB().QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
			t.Fatal(err)
		}
		if mode != "wal" {
			t.Errorf("journal_mode = %q, want wal", mode)
		}
		s.Close()
	}
}

func TestReadPoolIsReadOnly(t *testing.T) {
	s := open(t)
	if _, err := s.ReadDB().Exec(`INSERT INTO users (chzzk_id, chzzk_nickname) VALUES ('x', 'y')`); err == nil {
		t.Fatal("write through the read pool succeeded")
	}
}

func TestUpsertUserAndChannel(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	var first, second db.User
	err := s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		var err error
		if first, err = q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c1", ChzzkNickname: "old"}); err != nil {
			return err
		}
		if second, err = q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c1", ChzzkNickname: "new"}); err != nil {
			return err
		}
		return q.UpsertChannel(ctx, db.UpsertChannelParams{
			UserID: second.ID, ChzzkChannelID: "c1",
			AccessTokenEncrypted: ptr("a1"), RefreshTokenEncrypted: ptr("r1"), TokenExpiresAt: ptr[int64](100),
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || second.ChzzkNickname != "new" {
		t.Errorf("upsert: first=%+v second=%+v", first, second)
	}

	ch, err := s.Read.GetChannelByChzzkID(ctx, "c1")
	if err != nil {
		t.Fatal(err)
	}
	err = s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.UpdateChannelTokens(ctx, db.UpdateChannelTokensParams{
			ID: ch.ID, AccessTokenEncrypted: ptr("a2"), RefreshTokenEncrypted: ptr("r2"), TokenExpiresAt: ptr[int64](200),
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	ch, err = s.Read.GetChannelByChzzkID(ctx, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if *ch.AccessTokenEncrypted != "a2" || *ch.RefreshTokenEncrypted != "r2" || *ch.TokenExpiresAt != 200 {
		t.Errorf("tokens not updated: %+v", ch)
	}
	if _, err := s.Read.GetChannelByChzzkID(ctx, "nope"); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("missing channel: err = %v, want sql.ErrNoRows", err)
	}
}

func TestBadgeLookups(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	var u1, u2 db.User
	err := s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		var err error
		if u1, err = q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c1", ChzzkNickname: "dup"}); err != nil {
			return err
		}
		if u2, err = q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c2", ChzzkNickname: "dup"}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, s, `INSERT INTO varchive_links (user_id, varchive_nickname) VALUES (?, 'v1')`, u1.ID)
	mustExec(t, s, `INSERT INTO varchive_links (user_id, varchive_nickname, is_active) VALUES (?, 'v2', 0)`, u2.ID)
	for _, b := range []int{8, 4, 6} {
		mustExec(t, s, `INSERT INTO dj_classes (user_id, button, dj_class) VALUES (?, ?, 'BEGINNER I')`, u1.ID, b)
	}

	if u, err := s.Read.GetUserByChzzkID(ctx, "c2"); err != nil || u.ID != u2.ID {
		t.Errorf("by chzzk id: %+v %v", u, err)
	}
	if u, err := s.Read.GetUserByNickname(ctx, "dup"); err != nil || u.ID != u1.ID {
		t.Errorf("by nickname: got %+v %v, want oldest (id %d)", u, err, u1.ID)
	}
	if ok, err := s.Read.HasActiveLink(ctx, u1.ID); err != nil || !ok {
		t.Errorf("u1 active link = %v %v", ok, err)
	}
	if ok, err := s.Read.HasActiveLink(ctx, u2.ID); err != nil || ok {
		t.Errorf("u2 inactive link = %v %v", ok, err)
	}
	rows, err := s.Read.ListDjClasses(ctx, u1.ID)
	if err != nil {
		t.Fatal(err)
	}
	var buttons []int64
	for _, r := range rows {
		buttons = append(buttons, r.Button)
	}
	if fmt.Sprint(buttons) != "[4 6 8]" {
		t.Errorf("buttons = %v, want [4 6 8]", buttons)
	}
}

func TestConstraints(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	exec := func(query string, args ...any) error {
		_, err := s.WriteDB().ExecContext(ctx, query, args...)
		return err
	}
	if err := exec(`INSERT INTO users (chzzk_id, chzzk_nickname) VALUES ('c1', 'n')`); err != nil {
		t.Fatal(err)
	}
	bad := map[string]string{
		"foreign key":     `INSERT INTO dj_classes (user_id, button, dj_class) VALUES (999, 4, 'X')`,
		"button check":    `INSERT INTO dj_classes (user_id, button, dj_class) VALUES (1, 7, 'X')`,
		"preferred check": `UPDATE users SET preferred_button = 7 WHERE id = 1`,
		"is_active check": `INSERT INTO varchive_links (user_id, varchive_nickname, is_active) VALUES (1, 'v', 2)`,
		"unique chzzk_id": `INSERT INTO users (chzzk_id, chzzk_nickname) VALUES ('c1', 'other')`,
	}
	for name, query := range bad {
		if err := exec(query); err == nil {
			t.Errorf("%s: accepted %s", name, query)
		}
	}
	// Deleting a user cascades to its rows.
	if err := exec(`INSERT INTO dj_classes (user_id, button, dj_class) VALUES (1, 4, 'X')`); err != nil {
		t.Fatal(err)
	}
	if err := exec(`DELETE FROM users WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.ReadDB().QueryRow(`SELECT count(*) FROM dj_classes`).Scan(&n); err != nil || n != 0 {
		t.Errorf("dj_classes after cascade = %d %v", n, err)
	}
}

func TestWriteTxRollbackAndNesting(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	boom := errors.New("boom")
	err := s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		if _, err := q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c1", ChzzkNickname: "n"}); err != nil {
			return err
		}
		if err := s.WriteTx(ctx, func(context.Context, *db.Queries) error { return nil }); !errors.Is(err, ErrNestedWrite) {
			t.Errorf("nested WriteTx = %v, want ErrNestedWrite", err)
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("WriteTx = %v, want boom", err)
	}
	if _, err := s.Read.GetUserByChzzkID(ctx, "c1"); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("rolled-back user visible: err = %v", err)
	}
}

// Many concurrent writers queue on the single connection (no SQLITE_BUSY),
// while readers keep working.
func TestConcurrentWritesAndReads(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 100)
	for i := range 50 {
		wg.Go(func() {
			errs <- s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
				_, err := q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: fmt.Sprintf("c%d", i), ChzzkNickname: "n"})
				return err
			})
		})
		wg.Go(func() {
			_, err := s.Read.GetUserByNickname(ctx, "n")
			if errors.Is(err, sql.ErrNoRows) {
				err = nil
			}
			errs <- err
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := s.ReadDB().QueryRow(`SELECT count(*) FROM users`).Scan(&n); err != nil || n != 50 {
		t.Errorf("users = %d %v, want 50", n, err)
	}
}

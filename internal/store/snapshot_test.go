package store

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

func TestSnapshotIsConsistentAndRestorable(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	src := filepath.Join(dir, "live.sqlite3")
	s, err := Open(ctx, src)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	err = s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		_, err := q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c1", ChzzkNickname: "kept"})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	// A write transaction is open while the snapshot runs: it must neither
	// block the snapshot nor leak into it.
	tx, err := s.WriteDB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`INSERT INTO users (chzzk_id, chzzk_nickname) VALUES ('c2', 'uncommitted')`); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "snap.sqlite3")
	if err := Snapshot(ctx, src, dst); err != nil {
		t.Fatal(err)
	}
	tx.Rollback()

	// The snapshot opens as a normal store (migrations already applied) with
	// exactly the committed data.
	restored, err := Open(ctx, dst)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if u, err := restored.Read.GetUserByChzzkID(ctx, "c1"); err != nil || u.ChzzkNickname != "kept" {
		t.Errorf("committed row: %+v %v", u, err)
	}
	if _, err := restored.Read.GetUserByChzzkID(ctx, "c2"); err == nil {
		t.Error("uncommitted row leaked into the snapshot")
	}

	if err := Snapshot(ctx, src, dst); err == nil {
		t.Error("overwrote an existing snapshot")
	}
}

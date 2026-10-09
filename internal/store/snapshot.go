package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
)

// Snapshot writes a consistent copy of the database at srcPath to dstPath
// (which must not exist) while the server keeps running: VACUUM INTO on a
// separate read-only connection sees only committed data and never blocks
// writers. The copy is a single file (no -wal/-shm) and is checked with
// PRAGMA integrity_check; a copy that fails the check is removed.
func Snapshot(ctx context.Context, srcPath, dstPath string) (err error) {
	if _, statErr := os.Stat(dstPath); statErr == nil {
		return fmt.Errorf("store: snapshot target %s already exists", dstPath)
	}
	src, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro&_pragma=busy_timeout(5000)", srcPath))
	if err != nil {
		return err
	}
	defer src.Close()
	if _, err := src.ExecContext(ctx, "VACUUM INTO ?", dstPath); err != nil {
		return fmt.Errorf("store: snapshot: %w", err)
	}
	defer func() {
		if err != nil {
			_ = os.Remove(dstPath)
		}
	}()

	dst, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro", dstPath))
	if err != nil {
		return err
	}
	defer dst.Close()
	var result string
	if err := dst.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return fmt.Errorf("store: snapshot integrity check: %w", err)
	}
	if result != "ok" {
		return errors.New("store: snapshot failed integrity check: " + result)
	}
	return nil
}

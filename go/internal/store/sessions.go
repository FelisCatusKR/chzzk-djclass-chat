package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

// SessionStore implements scs.CtxStore on the sessions table: lookups use the
// read pool (every authenticated request does one), commits and deletes go
// through WriteTx (only when session data changes, e.g. login/logout).
type SessionStore struct{ s *Store }

func (s *Store) Sessions() *SessionStore { return &SessionStore{s} }

const julianFormat = "2006-01-02T15:04:05.999" // what julianday() parses, UTC

func (ss *SessionStore) FindCtx(ctx context.Context, token string) ([]byte, bool, error) {
	b, err := ss.s.Read.FindSession(ctx, token)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return b, true, nil
}

func (ss *SessionStore) CommitCtx(ctx context.Context, token string, b []byte, expiry time.Time) error {
	return ss.s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.CommitSession(ctx, db.CommitSessionParams{Token: token, Data: b, Julianday: expiry.UTC().Format(julianFormat)})
	})
}

func (ss *SessionStore) DeleteCtx(ctx context.Context, token string) error {
	return ss.s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.DeleteSession(ctx, token)
	})
}

// Context-free variants required by scs.Store.
func (ss *SessionStore) Find(token string) ([]byte, bool, error) {
	return ss.FindCtx(context.Background(), token)
}

func (ss *SessionStore) Commit(token string, b []byte, expiry time.Time) error {
	return ss.CommitCtx(context.Background(), token, b, expiry)
}

func (ss *SessionStore) Delete(token string) error {
	return ss.DeleteCtx(context.Background(), token)
}

// Cleanup deletes expired sessions every interval until ctx is done.
func (ss *SessionStore) Cleanup(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_ = ss.s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
				return q.DeleteExpiredSessions(ctx)
			})
		}
	}
}

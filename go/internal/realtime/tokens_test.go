package realtime

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

// Ported from djclass_overlay/overlay/tests/test_ingestor_lifecycle.py.

type fakeRefresher struct {
	calls int
	got   string
	err   error
}

func (f *fakeRefresher) Refresh(_ context.Context, rt string) (chzzk.Token, error) {
	f.calls++
	f.got = rt
	if f.err != nil {
		return chzzk.Token{}, f.err
	}
	return chzzk.Token{AccessToken: "NEW", RefreshToken: "NEWREFRESH", ExpiresIn: 86400}, nil
}

var now = time.Unix(1_800_000_000, 0)

func setupTokens(t *testing.T, expiresAt int64, withRefresh bool) (*Tokens, *fakeRefresher) {
	t.Helper()
	ctx := context.Background()
	s, err := store.Open(ctx, filepath.Join(t.TempDir(), "t.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	box, _ := crypto.New("test-key")
	access, refresh := box.Encrypt("OLD"), box.Encrypt("OLDREFRESH")
	params := db.UpsertChannelParams{ChzzkChannelID: "c1", AccessTokenEncrypted: &access, TokenExpiresAt: &expiresAt}
	if withRefresh {
		params.RefreshTokenEncrypted = &refresh
	}
	err = s.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		u, err := q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: "c1", ChzzkNickname: "N"})
		if err != nil {
			return err
		}
		params.UserID = u.ID
		return q.UpsertChannel(ctx, params)
	})
	if err != nil {
		t.Fatal(err)
	}
	r := &fakeRefresher{}
	return &Tokens{Store: s, Box: box, Chzzk: r, Now: func() time.Time { return now }}, r
}

func TestAccessTokenFresh(t *testing.T) {
	tok, r := setupTokens(t, now.Add(time.Hour).Unix(), true)
	got, err := tok.AccessToken(context.Background(), "c1")
	if err != nil || got != "OLD" || r.calls != 0 {
		t.Errorf("got %q %v, refresh calls %d", got, err, r.calls)
	}
}

func TestAccessTokenRefreshesNearExpiry(t *testing.T) {
	for name, expires := range map[string]int64{
		"expired":     now.Add(-time.Second).Unix(),
		"within skew": now.Add(refreshSkew - time.Second).Unix(),
	} {
		t.Run(name, func(t *testing.T) {
			tok, r := setupTokens(t, expires, true)
			ctx := context.Background()
			got, err := tok.AccessToken(ctx, "c1")
			if err != nil || got != "NEW" || r.got != "OLDREFRESH" {
				t.Fatalf("got %q %v (refreshed with %q)", got, err, r.got)
			}
			ch, _ := tok.Store.Read.GetChannelByChzzkID(ctx, "c1")
			a, _ := tok.Box.Decrypt(*ch.AccessTokenEncrypted)
			rt, _ := tok.Box.Decrypt(*ch.RefreshTokenEncrypted)
			if a != "NEW" || rt != "NEWREFRESH" || *ch.TokenExpiresAt != now.Unix()+86400 {
				t.Errorf("persisted access=%q refresh=%q expires=%d", a, rt, *ch.TokenExpiresAt)
			}
			// Now fresh: no second refresh.
			if got, _ := tok.AccessToken(ctx, "c1"); got != "NEW" || r.calls != 1 {
				t.Errorf("second call %q, refresh calls %d", got, r.calls)
			}
		})
	}
}

func TestAccessTokenErrors(t *testing.T) {
	tok, _ := setupTokens(t, now.Add(time.Hour).Unix(), true)
	if _, err := tok.AccessToken(context.Background(), "missing"); !errors.Is(err, ErrNoToken) {
		t.Errorf("missing channel: %v", err)
	}

	tok, _ = setupTokens(t, now.Unix(), false)
	if _, err := tok.AccessToken(context.Background(), "c1"); !errors.Is(err, ErrNoToken) {
		t.Errorf("expired without refresh token: %v", err)
	}

	tok, r := setupTokens(t, now.Unix(), true)
	r.err = errors.New("chzzk: HTTP 401")
	if _, err := tok.AccessToken(context.Background(), "c1"); !errors.Is(err, ErrNoToken) {
		t.Errorf("rejected refresh: %v", err)
	}
}

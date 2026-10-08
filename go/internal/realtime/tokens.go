package realtime

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

// ErrNoToken means the channel has no usable token (never logged in, or the
// refresh token is gone/rejected): the streamer has to log in again.
var ErrNoToken = errors.New("realtime: no usable Chzzk token for channel")

// refreshSkew refreshes a token this long before it expires, so a session URL
// fetch and the following subscribe never straddle the expiry.
const refreshSkew = 5 * time.Minute

type Refresher interface {
	Refresh(ctx context.Context, refreshToken string) (chzzk.Token, error)
}

// Tokens loads a channel's Chzzk access token, refreshing and persisting it
// when it is about to expire (port of ingestor.get_channel_access_token).
type Tokens struct {
	Store *store.Store
	Box   *crypto.Box
	Chzzk Refresher
	Now   func() time.Time // nil = time.Now
}

func (t *Tokens) now() time.Time {
	if t.Now != nil {
		return t.Now()
	}
	return time.Now()
}

func (t *Tokens) AccessToken(ctx context.Context, channelID string) (string, error) {
	ch, err := t.Store.Read.GetChannelByChzzkID(ctx, channelID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && ch.AccessTokenEncrypted == nil) {
		return "", ErrNoToken
	}
	if err != nil {
		return "", err
	}
	if ch.TokenExpiresAt == nil || t.now().Add(refreshSkew).Unix() < *ch.TokenExpiresAt {
		return t.Box.Decrypt(*ch.AccessTokenEncrypted)
	}

	if ch.RefreshTokenEncrypted == nil {
		return "", ErrNoToken
	}
	refresh, err := t.Box.Decrypt(*ch.RefreshTokenEncrypted)
	if err != nil {
		return "", err
	}
	// Network call outside any write transaction.
	tok, err := t.Chzzk.Refresh(ctx, refresh)
	if err != nil {
		return "", fmt.Errorf("%w (refresh failed: %v)", ErrNoToken, err)
	}
	access, refreshEnc := t.Box.Encrypt(tok.AccessToken), t.Box.Encrypt(tok.RefreshToken)
	expires := t.now().Unix() + int64(tok.ExpiresIn)
	err = t.Store.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		return q.UpdateChannelTokens(ctx, db.UpdateChannelTokensParams{
			ID: ch.ID, AccessTokenEncrypted: &access, RefreshTokenEncrypted: &refreshEnc, TokenExpiresAt: &expires,
		})
	})
	if err != nil {
		// The refresh token was likely rotated; losing it means re-login, so fail loudly.
		return "", fmt.Errorf("realtime: persisting refreshed token: %w", err)
	}
	return tok.AccessToken, nil
}

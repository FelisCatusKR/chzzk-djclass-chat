// Package importer loads the Django app's data into the Go SQLite store for
// the one-shot cutover. Input is `manage.py dumpdata users.user
// streamers.channel viewers.varchivetoken djclass.djclass` JSON. Primary keys
// and timestamps are kept; Django-only auth fields are dropped; sessions are
// not migrated (everyone logs in again).
//
// It refuses to run on a non-empty database and imports in one transaction.
// Before writing anything it decrypts every stored Chzzk token with the Go
// crypto package: if VARCHIVE_TOKEN_KEY is wrong (or the formats ever
// diverged), the import fails instead of silently stranding every streamer.
package importer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

type record struct {
	Model  string          `json:"model"`
	PK     int64           `json:"pk"`
	Fields json.RawMessage `json:"fields"`
}

type userFields struct {
	ChzzkID         string `json:"chzzk_id"`
	ChzzkNickname   string `json:"chzzk_nickname"`
	PreferredButton *int64 `json:"preferred_button"`
	CreatedAt       string `json:"created_at"`
}

type channelFields struct {
	User                       int64   `json:"user"`
	ChzzkChannelID             string  `json:"chzzk_channel_id"`
	ChzzkAccessTokenEncrypted  *string `json:"chzzk_access_token_encrypted"`
	ChzzkRefreshTokenEncrypted *string `json:"chzzk_refresh_token_encrypted"`
	TokenExpiresAt             *string `json:"token_expires_at"`
	CreatedAt                  string  `json:"created_at"`
}

type linkFields struct {
	User             int64  `json:"user"`
	VarchiveNickname string `json:"varchive_nickname"`
	VarchiveUserNo   *int64 `json:"varchive_user_no"`
	IsActive         bool   `json:"is_active"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type djClassFields struct {
	User              int64    `json:"user"`
	Button            int64    `json:"button"`
	DjClass           string   `json:"dj_class"`
	DjPowerSum        *float64 `json:"dj_power_sum"`
	MaxDjPower        *float64 `json:"max_dj_power"`
	DjPowerConversion *float64 `json:"dj_power_conversion"`
	SyncedAt          string   `json:"synced_at"`
}

// Report counts imported rows per table.
type Report struct {
	Users, Channels, Links, DjClasses, TokensVerified int
}

var ErrNotEmpty = errors.New("importer: target database already has users; refusing to import")

func Import(ctx context.Context, st *store.Store, box *crypto.Box, r io.Reader) (Report, error) {
	var recs []record
	if err := json.NewDecoder(r).Decode(&recs); err != nil {
		return Report{}, fmt.Errorf("importer: decode dumpdata: %w", err)
	}
	n, err := st.Read.CountUsers(ctx)
	if err != nil {
		return Report{}, err
	}
	if n > 0 {
		return Report{}, ErrNotEmpty
	}

	var (
		users    []db.ImportUserParams
		channels []db.ImportChannelParams
		links    []db.ImportVarchiveLinkParams
		classes  []db.ImportDjClassParams
		rep      Report
	)
	for _, rec := range recs {
		var err error
		switch rec.Model {
		case "users.user":
			var f userFields
			if err = json.Unmarshal(rec.Fields, &f); err != nil {
				break
			}
			var created int64
			if created, err = unix(f.CreatedAt); err != nil {
				break
			}
			users = append(users, db.ImportUserParams{
				ID: rec.PK, ChzzkID: f.ChzzkID, ChzzkNickname: f.ChzzkNickname,
				PreferredButton: f.PreferredButton, CreatedAt: created,
			})
		case "streamers.channel":
			var f channelFields
			if err = json.Unmarshal(rec.Fields, &f); err != nil {
				break
			}
			// Verify, never print: the error names the channel row only.
			for _, tok := range []*string{f.ChzzkAccessTokenEncrypted, f.ChzzkRefreshTokenEncrypted} {
				if tok == nil {
					continue
				}
				if _, derr := box.Decrypt(*tok); derr != nil {
					err = fmt.Errorf("token of channel pk=%d does not decrypt (wrong VARCHIVE_TOKEN_KEY?)", rec.PK)
					break
				}
				rep.TokensVerified++
			}
			if err != nil {
				break
			}
			var created int64
			if created, err = unix(f.CreatedAt); err != nil {
				break
			}
			var expires *int64
			if f.TokenExpiresAt != nil {
				var e int64
				if e, err = unix(*f.TokenExpiresAt); err != nil {
					break
				}
				expires = &e
			}
			channels = append(channels, db.ImportChannelParams{
				ID: rec.PK, UserID: f.User, ChzzkChannelID: f.ChzzkChannelID,
				AccessTokenEncrypted: f.ChzzkAccessTokenEncrypted, RefreshTokenEncrypted: f.ChzzkRefreshTokenEncrypted,
				TokenExpiresAt: expires, CreatedAt: created,
			})
		case "viewers.varchivetoken":
			var f linkFields
			if err = json.Unmarshal(rec.Fields, &f); err != nil {
				break
			}
			var created, updated int64
			if created, err = unix(f.CreatedAt); err != nil {
				break
			}
			if updated, err = unix(f.UpdatedAt); err != nil {
				break
			}
			links = append(links, db.ImportVarchiveLinkParams{
				ID: rec.PK, UserID: f.User, VarchiveNickname: f.VarchiveNickname, VarchiveUserNo: f.VarchiveUserNo,
				IsActive: f.IsActive, CreatedAt: created, UpdatedAt: updated,
			})
		case "djclass.djclass":
			var f djClassFields
			if err = json.Unmarshal(rec.Fields, &f); err != nil {
				break
			}
			var synced int64
			if synced, err = unix(f.SyncedAt); err != nil {
				break
			}
			classes = append(classes, db.ImportDjClassParams{
				ID: rec.PK, UserID: f.User, Button: f.Button, DjClass: f.DjClass,
				DjPowerSum: f.DjPowerSum, MaxDjPower: f.MaxDjPower, DjPowerConversion: f.DjPowerConversion, SyncedAt: synced,
			})
		default:
			err = errors.New("unexpected model (dump only the four models listed in the package doc)")
		}
		if err != nil {
			return Report{}, fmt.Errorf("importer: %s pk=%d: %w", rec.Model, rec.PK, err)
		}
	}

	// Parents first; FK, UNIQUE and CHECK constraints validate the rest.
	err = st.WriteTx(ctx, func(ctx context.Context, q *db.Queries) error {
		for _, u := range users {
			if err := q.ImportUser(ctx, u); err != nil {
				return fmt.Errorf("users pk=%d: %w", u.ID, err)
			}
		}
		for _, c := range channels {
			if err := q.ImportChannel(ctx, c); err != nil {
				return fmt.Errorf("channels pk=%d: %w", c.ID, err)
			}
		}
		for _, l := range links {
			if err := q.ImportVarchiveLink(ctx, l); err != nil {
				return fmt.Errorf("varchive_links pk=%d: %w", l.ID, err)
			}
		}
		for _, c := range classes {
			if err := q.ImportDjClass(ctx, c); err != nil {
				return fmt.Errorf("dj_classes pk=%d: %w", c.ID, err)
			}
		}
		return nil
	})
	if err != nil {
		return Report{}, fmt.Errorf("importer: %w", err)
	}
	rep.Users, rep.Channels, rep.Links, rep.DjClasses = len(users), len(channels), len(links), len(classes)
	return rep, nil
}

// unix parses Django's DjangoJSONEncoder datetimes ("2026-10-08T12:16:38.283Z").
func unix(s string) (int64, error) {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return 0, fmt.Errorf("bad timestamp %q: %w", s, err)
	}
	return t.Unix(), nil
}

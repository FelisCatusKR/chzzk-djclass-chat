package importer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/resolver"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
)

// testdata/django_dumpdata.json was produced by the real Django app
// (manage.py dumpdata on a scratch DB), tokens encrypted with this key.
const djangoKey = "test-key-not-a-secret-0123456789"

func setup(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "t.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func fixture(t *testing.T) *os.File {
	t.Helper()
	f, err := os.Open("testdata/django_dumpdata.json")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func TestImportDjangoDump(t *testing.T) {
	st := setup(t)
	box, _ := crypto.New(djangoKey)
	ctx := context.Background()
	rep, err := Import(ctx, st, box, fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	want := Report{Users: 3, Channels: 2, Links: 2, DjClasses: 2, TokensVerified: 3}
	if rep != want {
		t.Errorf("report = %+v, want %+v", rep, want)
	}

	ch, err := st.Read.GetChannelByChzzkID(ctx, "streamer01")
	if err != nil {
		t.Fatal(err)
	}
	if at, _ := box.Decrypt(*ch.AccessTokenEncrypted); at != "ACCESS-1" {
		t.Errorf("access token = %q", at)
	}
	if ch.TokenExpiresAt == nil || time.Unix(*ch.TokenExpiresAt, 0).Year() != 2026 {
		t.Errorf("expires = %v", ch.TokenExpiresAt)
	}
	v, _ := st.Read.GetChannelByChzzkID(ctx, "viewer01")
	if v.RefreshTokenEncrypted != nil || v.TokenExpiresAt != nil {
		t.Errorf("nullable token fields not kept null: %+v", v)
	}

	// The imported data drives the same badge as in Django.
	res, err := resolver.New(st.Read).Resolve(ctx, "viewer01")
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != resolver.Linked || res.Badge.Auto.Class != "SS II" || res.Badge.Viewer.Button != 8 {
		t.Errorf("viewer01 badge = %+v / %+v", res, res.Badge)
	}
	if res, _ := resolver.New(st.Read).Resolve(ctx, "old01"); res.Status != resolver.Unlinked {
		t.Errorf("inactive link resolved as %s", res.Status)
	}

	// New rows get ids after the imported ones (no PK collisions).
	if _, err := st.WriteDB().Exec(`INSERT INTO users (chzzk_id, chzzk_nickname) VALUES ('new', 'n')`); err != nil {
		t.Errorf("insert after import: %v", err)
	}
}

func TestImportRefusesWrongKeyWithoutWriting(t *testing.T) {
	st := setup(t)
	box, _ := crypto.New("not-the-production-key")
	_, err := Import(context.Background(), st, box, fixture(t))
	if err == nil || !strings.Contains(err.Error(), "does not decrypt") {
		t.Fatalf("err = %v", err)
	}
	if n, _ := st.Read.CountUsers(context.Background()); n != 0 {
		t.Errorf("%d users written despite the failure", n)
	}
}

func TestImportRefusesNonEmptyDB(t *testing.T) {
	st := setup(t)
	box, _ := crypto.New(djangoKey)
	if _, err := Import(context.Background(), st, box, fixture(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := Import(context.Background(), st, box, fixture(t)); !errors.Is(err, ErrNotEmpty) {
		t.Errorf("second import: %v", err)
	}
}

func TestImportRejectsBadInput(t *testing.T) {
	box, _ := crypto.New(djangoKey)
	for name, in := range map[string]string{
		"not json":      `nope`,
		"unknown model": `[{"model":"sessions.session","pk":1,"fields":{}}]`,
		"bad time":      `[{"model":"users.user","pk":1,"fields":{"chzzk_id":"a","chzzk_nickname":"n","created_at":"yesterday"}}]`,
		"orphan class":  `[{"model":"djclass.djclass","pk":1,"fields":{"user":99,"button":4,"dj_class":"X","synced_at":"2026-01-01T00:00:00Z"}}]`,
		"bad button":    `[{"model":"users.user","pk":1,"fields":{"chzzk_id":"a","chzzk_nickname":"n","preferred_button":7,"created_at":"2026-01-01T00:00:00Z"}}]`,
	} {
		st := setup(t)
		if _, err := Import(context.Background(), st, box, strings.NewReader(in)); err == nil {
			t.Errorf("%s: accepted", name)
		}
		if n, _ := st.Read.CountUsers(context.Background()); n != 0 {
			t.Errorf("%s: partial write (%d users)", name, n)
		}
	}
}

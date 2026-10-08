package web

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/realtime"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/resolver"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
)

// noTokens keeps channel workers idle (no Chzzk traffic) while the hub still
// registers channels, so Inject works.
type noTokens struct{}

func (noTokens) AccessToken(context.Context, string) (string, error) { return "", realtime.ErrNoToken }

type env struct {
	srv   *Server
	http  *httptest.Server
	store *store.Store
	hub   *realtime.Hub
}

func newEnv(t *testing.T, dev bool, chzzkAPI http.HandlerFunc) *env {
	t.Helper()
	ctx := context.Background()
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "t.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	box, _ := crypto.New("test-key")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := realtime.New(realtime.Config{
		Tokens: noTokens{}, Resolver: resolver.New(st.Read), Logger: log,
		FlushInterval: 5 * time.Millisecond, MinBackoff: time.Hour, MaxBackoff: time.Hour,
	})
	t.Cleanup(hub.Close)

	cz := chzzk.New("CID", "SECRET", "http://localhost:8000/api/auth/chzzk/callback")
	if chzzkAPI != nil {
		api := httptest.NewServer(chzzkAPI)
		t.Cleanup(api.Close)
		cz.TokenURL, cz.APIURL = api.URL+"/auth/v1/token", api.URL+"/open/v1"
	}
	s := &Server{
		Hub: hub, Store: st, Chzzk: cz, Box: box, BaseURL: "http://localhost:8000", Log: log, Dev: dev,
		Static: DjangoStatic(filepath.Join("..", "..", "..")),
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	if dev {
		if err := SeedDev(ctx, st); err != nil {
			t.Fatal(err)
		}
	}
	return &env{srv: s, http: ts, store: st, hub: hub}
}

func (e *env) addChannel(t *testing.T, id string) {
	t.Helper()
	err := e.store.WriteTx(context.Background(), func(ctx context.Context, q *db.Queries) error {
		u, err := q.UpsertUser(ctx, db.UpsertUserParams{ChzzkID: id, ChzzkNickname: "Streamer"})
		if err != nil {
			return err
		}
		return q.UpsertChannel(ctx, db.UpsertChannelParams{UserID: u.ID, ChzzkChannelID: id})
	})
	if err != nil {
		t.Fatal(err)
	}
}

func get(t *testing.T, url string) (*http.Response, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func TestWidgetPage(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, path := range []string{"/widget/abc123/", "/widget/abc123"} {
		resp, body := get(t, e.http.URL+path)
		if resp.StatusCode != 200 || !strings.Contains(body, `data-channel-id="abc123"`) {
			t.Errorf("%s: %d %s", path, resp.StatusCode, body)
		}
		if strings.Contains(body, "window.CHANNEL_ID") || !strings.Contains(body, `src="/static/overlay/widget.js"`) {
			t.Errorf("%s: unexpected script wiring", path)
		}
	}
	if _, body := get(t, e.http.URL+"/widget/%22%3E%3Cscript%3E/"); strings.Contains(body, `"><script>`) {
		t.Error("channel id not escaped")
	}
}

func TestHomeLinksToLogin(t *testing.T) {
	e := newEnv(t, false, nil)
	if resp, body := get(t, e.http.URL+"/"); resp.StatusCode != 200 || !strings.Contains(body, `href="/login"`) || strings.Contains(body, "/dev") {
		t.Errorf("home: %d %s", resp.StatusCode, body)
	}
	if resp, _ := get(t, e.http.URL+"/nope"); resp.StatusCode != 404 {
		t.Errorf("unknown path: %d", resp.StatusCode)
	}
}

func TestStaticAssets(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, p := range []string{"/static/overlay/widget.js", "/static/css/chat.css"} {
		if resp, body := get(t, e.http.URL+p); resp.StatusCode != 200 || len(body) == 0 {
			t.Errorf("%s: %d", p, resp.StatusCode)
		}
	}
	for _, p := range []string{"/static/", "/static/css/", "/static/other/x", "/static/css/../../../go.mod"} {
		if resp, _ := get(t, e.http.URL+p); resp.StatusCode != 404 {
			t.Errorf("%s: %d, want 404", p, resp.StatusCode)
		}
	}
}

func TestStreamUnknownChannelIs404(t *testing.T) {
	e := newEnv(t, false, nil)
	if resp, _ := get(t, e.http.URL+"/widget/nobody/stream"); resp.StatusCode != 404 {
		t.Errorf("status %d", resp.StatusCode)
	}
}

func TestStreamDeliversBatchesAndEndsOnClose(t *testing.T) {
	e := newEnv(t, true, nil)
	e.addChannel(t, "chan1")
	resp, err := http.Get(e.http.URL + "/widget/chan1/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" || resp.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("headers: %v", resp.Header)
	}
	r := bufio.NewReader(resp.Body)
	if line, _ := r.ReadString('\n'); line != ": connected\n" {
		t.Fatalf("first line %q", line)
	}
	r.ReadString('\n')

	e.hub.Inject("chan1", realtime.ChatMessage{SenderChannelID: "dev-showstopper", Nickname: "DEV 쇼스토퍼", Content: "안녕"})
	event, _ := r.ReadString('\n')
	data, _ := r.ReadString('\n')
	if event != "event: chat\n" || !strings.HasPrefix(data, "data: ") {
		t.Fatalf("got %q %q", event, data)
	}
	var batch struct {
		Messages []realtime.BatchMessage `json:"messages"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(data, "data: ")), &batch); err != nil {
		t.Fatal(err)
	}
	m := batch.Messages[0]
	if m.Text != "안녕" || m.Status != resolver.Linked || m.Badge.Auto.Class != "SS II" || m.Badge.Viewer.Button != 8 {
		t.Errorf("message %+v", m)
	}

	e.hub.Close()
	done := make(chan error, 1)
	go func() { _, err := io.ReadAll(r); done <- err }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("stream did not end after hub.Close")
	}
}

func chzzkFake(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/auth/v1/token":
			io.WriteString(w, `{"content":{"accessToken":"AT","refreshToken":"RT","expiresIn":86400}}`)
		case "/open/v1/users/me":
			io.WriteString(w, `{"content":{"channelId":"chanX","channelName":"스트리머"}}`)
		default:
			t.Errorf("unexpected Chzzk call %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}
}

func noRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

func TestLoginCallbackStoresEncryptedTokens(t *testing.T) {
	e := newEnv(t, false, chzzkFake(t))
	client := &http.Client{CheckRedirect: noRedirect}

	resp, err := client.Get(e.http.URL + "/login")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	loc, _ := url.Parse(resp.Header.Get("Location"))
	state := loc.Query().Get("state")
	var cookie *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == stateCookie {
			cookie = c
		}
	}
	if resp.StatusCode != http.StatusFound || state == "" || cookie == nil || cookie.Value != state || !cookie.HttpOnly {
		t.Fatalf("login: %d loc=%s cookie=%+v", resp.StatusCode, loc, cookie)
	}

	req, _ := http.NewRequest("GET", e.http.URL+"/api/auth/chzzk/callback?code=C&state="+state, nil)
	req.AddCookie(&http.Cookie{Name: stateCookie, Value: state})
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), "http://localhost:8000/widget/chanX/") {
		t.Fatalf("callback: %d %s", resp.StatusCode, body)
	}

	ch, err := e.store.Read.GetChannelByChzzkID(context.Background(), "chanX")
	if err != nil {
		t.Fatal(err)
	}
	if *ch.AccessTokenEncrypted == "AT" {
		t.Fatal("token stored in plaintext")
	}
	if at, _ := e.srv.Box.Decrypt(*ch.AccessTokenEncrypted); at != "AT" {
		t.Errorf("access token = %q", at)
	}
	if u, _ := e.store.Read.GetUserByChzzkID(context.Background(), "chanX"); u.ChzzkNickname != "스트리머" {
		t.Errorf("user = %+v", u)
	}
}

func TestCallbackRejectsBadState(t *testing.T) {
	e := newEnv(t, false, chzzkFake(t))
	for name, cookie := range map[string]string{"no cookie": "", "mismatch": "other"} {
		req, _ := http.NewRequest("GET", e.http.URL+"/api/auth/chzzk/callback?code=C&state=S", nil)
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: stateCookie, Value: cookie})
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d", name, resp.StatusCode)
		}
	}
	if _, err := e.store.Read.GetChannelByChzzkID(context.Background(), "chanX"); err == nil {
		t.Error("user saved despite bad state")
	}
}

func TestDevRoutes(t *testing.T) {
	prod := newEnv(t, false, nil)
	if resp, _ := get(t, prod.http.URL+"/dev"); resp.StatusCode != 404 {
		t.Errorf("/dev exists outside dev mode: %d", resp.StatusCode)
	}
	resp, err := http.PostForm(prod.http.URL+"/dev/chat", url.Values{"channel": {"x"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusSeeOther {
		t.Errorf("/dev/chat reachable outside dev mode: %d", resp.StatusCode)
	}

	dev := newEnv(t, true, nil)
	dev.addChannel(t, "chan1")
	sub, err := dev.hub.Subscribe("chan1")
	if err != nil {
		t.Fatal(err)
	}
	defer dev.hub.Unsubscribe(sub)
	client := &http.Client{CheckRedirect: noRedirect}
	resp, err = client.PostForm(dev.http.URL+"/dev/chat", url.Values{"channel": {"chan1"}, "sender": {"dev-unlinked"}, "text": {"hi"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther || !strings.Contains(resp.Header.Get("Location"), "flash=") {
		t.Errorf("dev chat: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	select {
	case data := <-sub.C:
		if !strings.Contains(string(data), `"status":"unlinked"`) {
			t.Errorf("batch %s", data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("injected chat not delivered")
	}
}

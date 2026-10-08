package web

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alexedwards/scs/v2"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/link"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/ratelimit"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/realtime"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/resolver"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store/db"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/varchive"
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
	va    *vaFake
}

// vaFake is a V-ARCHIVE stand-in: token "good" is valid for nickname "VA",
// whose classes are whatever the test puts in classes (button → JSON).
type vaFake struct {
	mu      sync.Mutex
	classes map[string]string
}

func (f *vaFake) handler(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.URL.Path == "/api/v2/open-token/user" {
		if r.Header.Get("Authorization") != "Bearer good" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		io.WriteString(w, `{"success":true,"userNo":7,"nickname":"VA"}`)
		return
	}
	button := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
	if body, ok := f.classes[button]; ok && strings.HasPrefix(r.URL.Path, "/api/v2/archive/VA/") {
		io.WriteString(w, body)
		return
	}
	http.NotFound(w, r)
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
	va := &vaFake{classes: map[string]string{
		"4": `{"success":true,"djClass":"SHOWSTOPPER II","djPowerConversion":9823.0}`,
		"8": `{"success":true,"djClass":"HEADLINER IV","djPowerConversion":9410.0}`,
	}}
	vaSrv := httptest.NewServer(http.HandlerFunc(va.handler))
	t.Cleanup(vaSrv.Close)
	vaClient := varchive.New()
	vaClient.BaseURL = vaSrv.URL
	badges := resolver.New(st.Read)

	sessions := scs.New()
	sessions.Store = st.Sessions()
	s := &Server{
		Hub: hub, Store: st, Chzzk: cz, Box: box, Sessions: sessions, Limiter: ratelimit.New(nil),
		Link:    &link.Service{Store: st, VA: vaClient, Cache: badges, Log: log},
		BaseURL: "http://localhost:8000", Log: log, Dev: dev,
		Static: DjangoStatic(filepath.Join("..", "..")),
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	if dev {
		if err := SeedDev(ctx, st); err != nil {
			t.Fatal(err)
		}
	}
	return &env{srv: s, http: ts, store: st, hub: hub, va: va}
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

func TestPagesRender(t *testing.T) {
	e := newEnv(t, false, nil)
	for path, want := range map[string]string{
		"/":                            "Chzzk DJ CLASS 채팅 위젯",
		"/login/":                      "Chzzk로 로그인",
		"/login/?next=%2Fdashboard%2F": "위젯 설정을 위해",
	} {
		resp, body := get(t, e.http.URL+path)
		if resp.StatusCode != 200 || !strings.Contains(body, want) {
			t.Errorf("%s: %d, missing %q", path, resp.StatusCode, want)
		}
	}
	if _, body := get(t, e.http.URL+"/login/?next=%2Fdashboard%2F"); !strings.Contains(body, `href="/api/auth/chzzk?next=%2fdashboard%2f"`) {
		t.Errorf("login link does not carry next: %s", body)
	}
	client := &http.Client{CheckRedirect: noRedirect}
	for from, to := range map[string]string{"/login": "/login/", "/dashboard": "/dashboard/", "/dashboard/": "/login/?next=%2Fdashboard%2F"} {
		resp, err := client.Get(e.http.URL + from)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if loc := resp.Header.Get("Location"); loc != to {
			t.Errorf("%s → %q, want %q", from, loc, to)
		}
	}
	if resp, _ := get(t, e.http.URL+"/nope"); resp.StatusCode != 404 {
		t.Errorf("unknown path: %d", resp.StatusCode)
	}
}

func TestSecurityHeaders(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, path := range []string{"/", "/widget/abc/"} {
		resp, _ := get(t, e.http.URL+path) // both policies keep these
		h := resp.Header
		csp := h.Get("Content-Security-Policy")
		for _, want := range []string{"default-src 'self'", "https://*.pstatic.net", "https://*.naver.net", "frame-ancestors 'none'"} {
			if !strings.Contains(csp, want) {
				t.Errorf("%s: CSP lacks %q: %s", path, want, csp)
			}
		}
		if strings.Contains(csp, "script-src 'self' 'unsafe-inline'") {
			t.Errorf("inline scripts allowed: %s", csp)
		}
		if h.Get("X-Frame-Options") != "DENY" || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Strict-Transport-Security") != "" {
			t.Errorf("%s: headers %v", path, h)
		}
	}
	if resp, _ := get(t, e.http.URL+"/widget/abc/"); strings.Contains(resp.Header.Get("Content-Security-Policy"), "unsafe-eval") {
		t.Error("widget CSP allows eval")
	}
	if resp, _ := get(t, e.http.URL+"/"); resp.Header.Get("Cache-Control") != "no-store" {
		t.Error("session pages are cacheable")
	}
	rec := httptest.NewRecorder()
	securityHeaders(true, http.NotFoundHandler()).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if !strings.Contains(rec.Header().Get("Strict-Transport-Security"), "max-age=31536000") {
		t.Error("no HSTS for https")
	}
}

func TestCrossOriginPostRejected(t *testing.T) {
	e := newEnv(t, false, nil)
	for site, want := range map[string]int{"cross-site": 403, "same-site": 403, "same-origin": 303} {
		req, _ := http.NewRequest("POST", e.http.URL+"/logout/", nil)
		req.Header.Set("Sec-Fetch-Site", site)
		resp, err := (&http.Client{CheckRedirect: noRedirect}).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("Sec-Fetch-Site %s: %d, want %d", site, resp.StatusCode, want)
		}
	}
	req, _ := http.NewRequest("POST", e.http.URL+"/logout/", nil)
	req.Header.Set("Origin", "https://evil.example")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Errorf("foreign Origin: %d", resp.StatusCode)
	}
}

func TestRequireLoginForHtmx(t *testing.T) {
	e := newEnv(t, false, nil)
	cases := []struct {
		name, path, boosted, want string
	}{
		// hx-boost link from the landing page to /dashboard/: a navigation → return to /dashboard/.
		{"boosted navigation", "/dashboard/", "true", "/login/?next=%2Fdashboard%2F"},
		// fragment request issued from /link/ (e.g. hx-post to a card endpoint) → return to /link/.
		{"fragment request", "/dashboard/", "", "/login/?next=%2Flink%2F"},
	}
	for _, c := range cases {
		req, _ := http.NewRequest("GET", e.http.URL+c.path, nil)
		req.Header.Set("HX-Request", "true")
		req.Header.Set("HX-Current-URL", e.http.URL+"/link/")
		if c.boosted != "" {
			req.Header.Set("HX-Boosted", c.boosted)
		}
		resp, err := (&http.Client{CheckRedirect: noRedirect}).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("HX-Redirect") != c.want {
			t.Errorf("%s: %d HX-Redirect=%q, want %q", c.name, resp.StatusCode, resp.Header.Get("HX-Redirect"), c.want)
		}
	}
}

func TestSafeNextPath(t *testing.T) {
	for in, want := range map[string]string{
		"/link/": "/link/", "": "/d/", "dashboard": "/d/", "https://evil.example": "/d/",
		"//evil.example": "/d/", `/\evil.example`: "/d/", "/\t/evil.example": "/d/", "/ok?x=1": "/ok?x=1",
	} {
		if got := safeNextPath(in, "/d/"); got != want {
			t.Errorf("safeNextPath(%q) = %q, want %q", in, got, want)
		}
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

func TestLoginFlow(t *testing.T) {
	e := newEnv(t, false, chzzkFake(t))
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, CheckRedirect: noRedirect}

	resp, err := client.Get(e.http.URL + "/api/auth/chzzk?next=%2Flink%2F")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	loc, _ := url.Parse(resp.Header.Get("Location"))
	state := loc.Query().Get("state")
	if resp.StatusCode != http.StatusFound || loc.Host != "chzzk.naver.com" || state == "" {
		t.Fatalf("start: %d %s", resp.StatusCode, loc)
	}
	for _, c := range resp.Cookies() {
		if !c.HttpOnly || c.Path != oauthPath {
			t.Errorf("cookie %s: %+v", c.Name, c)
		}
	}

	resp, err = client.Get(e.http.URL + "/api/auth/chzzk/callback?code=C&state=" + state)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/link/" {
		t.Fatalf("callback: %d → %q (want the saved next)", resp.StatusCode, resp.Header.Get("Location"))
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

	// Logged in: dashboard shows the widget URL; login page bounces.
	resp, err = client.Get(e.http.URL + "/dashboard/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), `data-widget-base="http://localhost:8000/widget/chanX/"`) {
		t.Fatalf("dashboard: %d", resp.StatusCode)
	}
	if resp, _ := client.Get(e.http.URL + "/login/"); resp.Header.Get("Location") != "/dashboard/" {
		t.Errorf("login page while logged in → %q", resp.Header.Get("Location"))
	}

	// Logout ends the session server-side.
	req, _ := http.NewRequest("POST", e.http.URL+"/logout/", nil)
	if resp, err = client.Do(req); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp, _ := client.Get(e.http.URL + "/dashboard/"); resp.StatusCode != http.StatusFound {
		t.Errorf("dashboard after logout: %d", resp.StatusCode)
	}
}

func TestCallbackRejectsBadStateAndRateLimits(t *testing.T) {
	e := newEnv(t, false, chzzkFake(t))
	client := &http.Client{CheckRedirect: noRedirect}
	for name, cookie := range map[string]string{"no cookie": "", "mismatch": "other"} {
		req, _ := http.NewRequest("GET", e.http.URL+"/api/auth/chzzk/callback?code=C&state=S", nil)
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: stateCookie, Value: cookie})
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.Header.Get("Location") != "/?error=auth_failed" {
			t.Errorf("%s: %d → %q", name, resp.StatusCode, resp.Header.Get("Location"))
		}
	}
	if _, err := e.store.Read.GetChannelByChzzkID(context.Background(), "chanX"); err == nil {
		t.Error("user saved despite bad state")
	}
	last := 0
	for range 10 {
		resp, _ := client.Get(e.http.URL + "/api/auth/chzzk/callback")
		resp.Body.Close()
		last = resp.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("12th callback: %d, want 429", last)
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

// login runs the OAuth flow against the fake Chzzk API and returns a client
// carrying the session cookie (user chanX).
func login(t *testing.T, e *env) *http.Client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, CheckRedirect: noRedirect}
	resp, err := c.Get(e.http.URL + "/api/auth/chzzk")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	loc, _ := url.Parse(resp.Header.Get("Location"))
	resp, err = c.Get(e.http.URL + "/api/auth/chzzk/callback?code=C&state=" + loc.Query().Get("state"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("login failed: %d", resp.StatusCode)
	}
	return c
}

func post(t *testing.T, c *http.Client, u string, form url.Values) (int, string) {
	t.Helper()
	req, _ := http.NewRequest("POST", u, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("HX-Request", "true")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func getWith(t *testing.T, c *http.Client, u string) (int, string) {
	t.Helper()
	resp, err := c.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// Ported from viewers/tests/test_pages.py and test_link_actions.py.
func TestLinkFlow(t *testing.T) {
	e := newEnv(t, false, chzzkFake(t))
	anon := &http.Client{CheckRedirect: noRedirect}
	if resp, _ := anon.Get(e.http.URL + "/link/"); resp.Header.Get("Location") != "/login/?next=%2Flink%2F" {
		t.Errorf("anonymous /link/ → %q", resp.Header.Get("Location"))
	}
	if code, _ := post(t, anon, e.http.URL+"/link/sync/", nil); code != 200 {
		t.Errorf("anonymous htmx post: %d", code) // HX-Redirect, checked in TestRequireLoginForHtmx
	}

	c := login(t, e)
	code, body := getWith(t, c, e.http.URL+"/link/")
	for _, want := range []string{"스트리머님, 환영합니다!", "조회토큰을 입력하세요", "V-ARCHIVE 마이페이지", `hx-post="/link/connect/"`, `id="link-card"`, `hx-select="#link-card"`} {
		if !strings.Contains(body, want) {
			t.Errorf("unlinked page lacks %q", want)
		}
	}
	if code != 200 || strings.Contains(body, "버튼 선택") || strings.Contains(body, "rendered inside the page") {
		t.Errorf("unlinked page: %d, picker or template comment leaked", code)
	}

	if _, body := post(t, c, e.http.URL+"/link/connect/", url.Values{"token": {""}}); !strings.Contains(body, "조회토큰을 입력하세요.") {
		t.Errorf("empty token: %s", body)
	}
	if _, body := post(t, c, e.http.URL+"/link/connect/", url.Values{"token": {"bad"}}); !strings.Contains(body, "조회토큰이 유효하지 않습니다") {
		t.Errorf("bad token: %s", body)
	}
	_, body = post(t, c, e.http.URL+"/link/connect/", url.Values{"token": {" good "}})
	if strings.Contains(body, "<html") {
		t.Error("htmx response is a full page, want the card fragment")
	}
	for _, want := range []string{"연동 완료! 이제 채팅에서", "VA와 연동 완료", `hx-post="/link/sync/"`, `hx-post="/link/unlink/"`, "버튼 선택", "자동 (최고 클래스)", "4버튼", "SS II", "9823", "9800+"} {
		if !strings.Contains(body, want) {
			t.Errorf("linked card lacks %q", want)
		}
	}

	_, body = post(t, c, e.http.URL+"/link/sync/", nil)
	if !strings.Contains(body, "DJ CLASS 동기화 완료: 4B SHOWSTOPPER II") {
		t.Errorf("sync: %s", body)
	}
	_, body = post(t, c, e.http.URL+"/link/preferred-button/", url.Values{"button": {"8"}})
	if !strings.Contains(body, `value="8"
                           class="h-4 w-4"
                           checked`) {
		t.Errorf("preferred 8 not checked: %s", body)
	}
	if _, body := post(t, c, e.http.URL+"/link/preferred-button/", url.Values{"button": {"5"}}); !strings.Contains(body, "잘못된 버튼 선택입니다.") {
		t.Errorf("invalid button: %s", body)
	}

	// Nickname changed on V-ARCHIVE: fetch comes back empty, rows are kept.
	e.va.mu.Lock()
	e.va.classes = map[string]string{}
	e.va.mu.Unlock()
	if _, body := post(t, c, e.http.URL+"/link/sync/", nil); !strings.Contains(body, "V-ARCHIVE 닉네임이 바뀌었다면") || !strings.Contains(body, "4버튼") {
		t.Errorf("stale sync: %s", body)
	}
	// Third sync within the minute is still allowed; the fourth is limited.
	if _, body := post(t, c, e.http.URL+"/link/sync/", nil); strings.Contains(body, "요청이 너무 많습니다") {
		t.Error("3rd sync limited")
	}
	if code, body := post(t, c, e.http.URL+"/link/sync/", nil); code != http.StatusTooManyRequests || !strings.Contains(body, "요청이 너무 많습니다") || !strings.Contains(body, `id="link-card"`) {
		t.Errorf("4th sync: %d, want 429 with the card", code)
	}

	_, body = post(t, c, e.http.URL+"/link/unlink/", nil)
	if !strings.Contains(body, "V-ARCHIVE 연동을 해제했습니다.") || !strings.Contains(body, "조회토큰을 입력하세요") || strings.Contains(body, "버튼 선택") {
		t.Errorf("unlink: %s", body)
	}
}

// The server's ReadTimeout would cancel a long-lived SSE request; the handler
// must lift it. Also: over the subscriber cap the stream answers 503.
func TestStreamOutlivesReadTimeoutAndIsCapped(t *testing.T) {
	e := newEnv(t, true, nil)
	e.addChannel(t, "chan1")
	ts := httptest.NewUnstartedServer(e.srv.Handler())
	ts.Config.ReadTimeout = 200 * time.Millisecond
	ts.Start()
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/widget/chan1/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	r := bufio.NewReader(resp.Body)
	r.ReadString('\n')
	r.ReadString('\n')
	time.Sleep(600 * time.Millisecond) // well past ReadTimeout
	e.hub.Inject("chan1", realtime.ChatMessage{SenderChannelID: "dev-unlinked", Content: "late"})
	got := make(chan string, 1)
	go func() {
		r.ReadString('\n')
		line, _ := r.ReadString('\n')
		got <- line
	}()
	select {
	case line := <-got:
		if !strings.Contains(line, `"text":"late"`) {
			t.Errorf("got %q", line)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream died after ReadTimeout")
	}

	for i := 0; ; i++ { // fill channel chan1 up to the per-channel cap
		resp, err := http.Get(ts.URL + "/widget/chan1/stream")
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode == http.StatusServiceUnavailable {
			resp.Body.Close()
			if i != 9 { // one stream already open above; cap is 10
				t.Errorf("503 after %d extra streams, want 9", i)
			}
			break
		}
		defer resp.Body.Close()
		if i > 20 {
			t.Fatal("no subscriber cap")
		}
	}
}

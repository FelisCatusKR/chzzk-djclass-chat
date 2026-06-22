# Pages + Widget Polish (daisyUI) — Implementation Plan (migration plan 6/8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the streamer-facing web pages (landing, login, dashboard) as Django templates styled with **daisyUI** + light **Alpine.js** interactivity, and complete Plan 5's deferred **widget visual polish** (rank colors + theory glint + opacity) — reproducing the Node app's behavior and Korean copy on a clean stock daisyUI theme.

**Architecture:** Server-rendered Django views + templates. Styling is **daisyUI v5 + Tailwind v4 loaded from the official CDN** (`@tailwindcss/browser@4` generates utilities at runtime + `daisyui@5` provides components — no build, no Node) on the low-traffic config pages; the always-on OBS overlay stays **CDN-free** on a hand-written `badge.css`. The dashboard's widget configurator builds the widget URL **entirely client-side in Alpine** (no API) from the logged-in channel's id, and a live preview cycles fake messages. Badge colors/glint live in `badge.css` keyed by the short rank name the SSE event already carries (spec §4.4.1: "색상 = rank 기반 CSS 클래스"), shared by the OBS widget and the dashboard preview.

**Tech Stack:** Django 6.0 templates + function views, **daisyUI v5 + Tailwind v4 via the official CDN** (`@tailwindcss/browser@4` + `daisyui@5`, no build/Node), **Alpine.js** (CDN), hand-written `badge.css` for the overlay, WhiteNoise static serving, pytest-django (content assertions on rendered pages).

---

## Decisions baked in (from brainstorming, 2026-06-23)

- **Visual:** clean **stock daisyUI theme** (default `night` — dark, swap via one `data-theme`), NOT a reproduction of the Node app's bespoke frosted-glass/cover-image look. Korean copy reproduced verbatim; layout/behavior reproduced.
- **CSS tooling:** **daisyUI + Tailwind via the official CDN** (`@tailwindcss/browser@4` + `daisyui@5`) — no build, no Node, no binary, nothing to rebuild after editing templates. Only the low-traffic config pages load the CDN; the always-on OBS overlay stays CDN-free on hand-written `badge.css`. Trade-off accepted: the browser build compiles at load → brief FOUC + a jsdelivr runtime dependency on those pages; fine for occasionally-visited config pages, never on the overlay.
- **Scope:** **streamer pages only** — landing, login, dashboard (with the 2-pane configurator AND the Alpine live preview), plus the widget visual polish. The **viewer link page is deferred to Plan 7**, where the V-ARCHIVE client + DJ CLASS sync it depends on are built; Plan 6 adds a minimal login-gated `/link` placeholder so the landing card isn't a dead link.

> **No new JSON APIs.** The Node dashboard fetched `/api/channel` for `widgetUrl`; here the Django `dashboard` view passes the channel's widget base URL in the template context, and Alpine appends params client-side. (The Node app's `/api/*` routes are Plan 7.)

> **No build artifacts.** Styling comes from the CDN at runtime; there is nothing to build, fetch, or gitignore. Tests assert page *content/structure* (status codes, Korean strings, control elements, URLs), which is independent of the CDN-rendered styling.

## Reference: the Node pages being reproduced

- **Landing** (`src/components/LandingPage.tsx`): title "Chzzk DJ CLASS 채팅 위젯" + subtitle; two cards — 🎛️ STREAMER → `/dashboard` ("채팅 위젯 얻기 →"), 🎧 VIEWER → `/link` ("DJ CLASS 연동하기 →"); footer (Special Thanks 똘똘똘이, GitHub, DJMAX disclaimer).
- **Login** (`src/app/login/page.tsx`): 🔒 "로그인이 필요해요"; context copy by `next` (`/dashboard`→"위젯 설정을 위해", `/link`→"DJ CLASS 연동을 위해"); "Chzzk로 로그인" → `/api/auth/chzzk?next=…`; "← 메인으로 돌아가기"; redirects away if already authed.
- **Dashboard** (`src/components/DashboardPage.tsx`): title "채팅 위젯 설정"; 2-pane `lg:grid-cols-[1.7fr_1fr]`, left = masonry of 4 cards (뱃지 모드 / 글자 크기 / 버튼 선택 모드 / 비활성 채팅 페이드아웃), right (sticky) = 위젯 미리보기 + 위젯 URL (URL 복사/복사됨!, 위젯 열기) + OBS 설정 방법 (collapse, 4 steps); bottom = 로그아웃 + "← 돌아가기". `getWidgetUrl()` sets `mode`+`fontSize` always, `buttonSel=viewer` only if viewer, `fadeout=<sec>` only if on.
- **Live preview** (`WidgetPreview.tsx` + `FAKE_CHAT_MESSAGES`): dark 400×200 box, one fake message every 500–1200 ms, max 15 visible, reflects only `mode`+`fontSize`.
- **Badge styling** (`dj-class-badge.module.css`, `DJ_CLASS_COLORS`, `glintDelayMs`): per-rank gradient background, theory glint sweep (power ≥ 10000) phase-locked to wall-clock, unverified rows at 75% opacity.

---

### Task 1: CSS foundation — daisyUI + Tailwind via CDN + base.html + static dir

Wire styling via the official daisyUI + Tailwind browser CDN (no build, no Node), a project static dir for shared assets (`badge.css`, the preview JS), and a real `base.html`. The OBS overlay stays CDN-free on `badge.css`.

**Files:**
- Create: `djclass_overlay/static/css/badge.css`
- Modify: `config/settings/base.py` (STATICFILES_DIRS), `djclass_overlay/templates/base.html`

- [ ] **Step 1: Add a project static dir.** In `config/settings/base.py`, after the `STATIC_ROOT`/`WHITENOISE_USE_FINDERS` lines, add:

```python
STATICFILES_DIRS = [BASE_DIR / "djclass_overlay" / "static"]
```

> Project-wide shared static (`badge.css`, the dashboard preview JS) lives in `djclass_overlay/static/`; app-level `static/` dirs (e.g. `overlay/static/`) keep working via `AppDirectoriesFinder`.

- [ ] **Step 2: Badge styles** (`djclass_overlay/static/css/badge.css`) — hand-written (CDN-free, used by the overlay AND the dashboard preview), keyed by the short rank the SSE event sends. Gradients ported from `DJ_CLASS_COLORS` (`src/lib/dj-class.ts`); glint from `dj-class-badge.module.css`:

```css
/* DJ CLASS badge colors + theory glint. Port of src/lib/dj-class.ts DJ_CLASS_COLORS
   (re-keyed full-rank -> short rank) + dj-class-badge.module.css. */
.dj-badge {
  display: inline-block;
  padding: 0 4px;
  margin-right: 4px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 0.85em;
  color: #000;
  text-shadow: 0 0 1px rgba(255, 255, 255, 0.5);
}
.dj-badge.unverified { background: #6b7280; color: #fff; }

.rank-LoD { background: linear-gradient(to right, #f2b2f7, #acebff); }
.rank-BM  { background: linear-gradient(135deg, #ff7183, #ff8a9a); }
.rank-SS  { background: linear-gradient(135deg, #ff856f, #ff9a87); }
.rank-HL  { background: linear-gradient(135deg, #ff9758, #ffaa75); }
.rank-TS  { background: linear-gradient(135deg, #ffaf51, #ffbf70); }
.rank-PRO { background: linear-gradient(135deg, #ffd352, #ffdd70); }
.rank-HC  { background: linear-gradient(135deg, #feff63, #feff85); }
.rank-PD  { background: linear-gradient(135deg, #c7e644, #d1eb60); }
.rank-MM  { background: linear-gradient(135deg, #9ae28a, #a8e89c); }
.rank-SD  { background: linear-gradient(135deg, #92eaca, #a2edd2); }
.rank-RK  { background: linear-gradient(135deg, #78e3da, #8ee8e0); }
.rank-AM  { background: linear-gradient(135deg, #8eccdb, #a2d6e2); }
.rank-TR  { background: linear-gradient(135deg, #a9d0ee, #bdd8f0); }
.rank-BG  { background: linear-gradient(135deg, #c0c0c0, #d0d0d0); }

/* Theory (power >= 10000): a glossy highlight sweeps across, phase-locked via
   --glint-delay so it doesn't restart when chat scrolls. */
@keyframes glint { 0% { left: -60%; } 55%, 100% { left: 130%; } }
.dj-badge.shiny { position: relative; clip-path: inset(0 round 0.25rem); }
.dj-badge.shiny::after {
  content: "";
  position: absolute;
  top: 0; left: -60%;
  width: 40%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.85), transparent);
  transform: skewX(-20deg);
  animation: glint var(--glint-duration, 2600ms) ease-in-out infinite;
  animation-delay: var(--glint-delay, 0ms);
}

/* Faded (inactive) chat rows. */
.row { transition: opacity 0.5s; }
.row.fading { opacity: 0; }
.row.unverified-row { opacity: 0.75; }
```

- [ ] **Step 3: Rebuild `base.html`** (`djclass_overlay/templates/base.html`) with the CDN tags:

```html
{% load static %}
<!doctype html>
<html lang="ko" data-theme="night">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{% block title %}DJ CLASS Overlay{% endblock %}</title>
    <!-- daisyUI components + all themes, Tailwind utilities at runtime (no build, no Node). -->
    <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
    <link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
    <link rel="stylesheet" href="{% static 'css/badge.css' %}" />
  </head>
  <body class="min-h-screen bg-base-200">
    {% block content %}{% endblock %}
  </body>
</html>
```

> `daisyui@5` = components + light/dark; `daisyui@5/themes.css` = all built-in themes (incl. `night`); `@tailwindcss/browser@4` generates utility classes from the DOM at runtime (and via a MutationObserver, for Alpine-added nodes); Alpine from CDN. Swap the theme via `data-theme` (any theme in `themes.css`). Pin exact versions (`daisyui@5.0.50`, `@tailwindcss/browser@4.1.13`, `alpinejs@3.14.1`) if you prefer reproducibility over auto-patching — confirm current stable when implementing.

- [ ] **Step 4: Verify.**

```bash
uv run python manage.py check
uv run pytest -q
```

Expected: `check` clean; full suite green (85). (Tests assert page content, not CDN-rendered styling.)

> **CDN smoke-check (owner, in a browser — do this once after Task 2's landing exists):** confirm daisyUI actually renders, specifically that **theme-color utilities** apply — `bg-base-200` on the body, `btn-primary`, `bg-base-100` cards — not just generic utilities. This is the one CDN unknown (prebuilt daisyUI CSS + browser-Tailwind interaction for theme colors). It's the documented official path, so it should "just work"; if a color utility doesn't apply, the fix is small (pin versions / ensure `themes.css` is loaded) and caught before building all the pages on it. Full visual walk-through is Task 8.

- [ ] **Step 5: Commit.**

```bash
git add config/settings/base.py djclass_overlay/static/css/badge.css djclass_overlay/templates/base.html
git commit -m "feat(pages): daisyUI + Tailwind via CDN, base.html, badge.css (no build)"
```

---

### Task 2: Landing page `/` — TDD

A public landing with the streamer/viewer fork. Lives in the `streamers` app (it's the streamer-facing entry; `viewers` owns the link page in Plan 7).

**Files:**
- Create: `djclass_overlay/streamers/urls.py`, `djclass_overlay/templates/pages/landing.html`, `djclass_overlay/streamers/tests/test_pages.py`
- Modify: `djclass_overlay/streamers/views.py`, `config/urls.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/streamers/tests/test_pages.py`):

```python
def test_landing_renders(client):
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.content.decode()
    assert "Chzzk DJ CLASS 채팅 위젯" in body
    assert "스트리머이신가요?" in body
    assert "시청자이신가요?" in body
    assert 'href="/dashboard/"' in body
    assert 'href="/link/"' in body
    assert "DJMAX RESPECT V" in body  # footer disclaimer
```

- [ ] **Step 2: Run — expect fail** (404). `uv run pytest djclass_overlay/streamers/tests/test_pages.py -q`

- [ ] **Step 3: View** (`djclass_overlay/streamers/views.py`):

```python
from django.shortcuts import render


def landing(request):
    return render(request, "pages/landing.html")
```

- [ ] **Step 4: Template** (`djclass_overlay/templates/pages/landing.html`):

```html
{% extends "base.html" %}
{% block title %}Chzzk DJ CLASS 채팅 위젯{% endblock %}
{% block content %}
<main class="flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:py-12">
  <div class="w-full max-w-3xl space-y-8 text-center">
    <div class="space-y-2">
      <h1 class="text-4xl font-bold">Chzzk DJ CLASS 채팅 위젯</h1>
      <p class="text-lg opacity-70">V-ARCHIVE의 DJ CLASS를 채팅에 표시하는 OBS 위젯 서비스입니다.</p>
    </div>

    <div class="flex flex-col gap-5 md:flex-row">
      <a href="/dashboard/" class="card flex-1 bg-base-100 p-7 shadow-lg transition-transform hover:-translate-y-1">
        <div class="mb-2 text-4xl">🎛️</div>
        <span class="badge badge-neutral mb-3 font-bold tracking-wide">STREAMER</span>
        <h2 class="mb-2 text-xl font-bold">스트리머이신가요?</h2>
        <p class="mb-5 min-h-[3rem] text-sm leading-relaxed opacity-70">
          내 채팅에 시청자들의 DJ CLASS 뱃지를 표시하는 위젯을 OBS에 추가하려면 이 쪽을 클릭해주세요.
        </p>
        <span class="btn btn-neutral btn-block">채팅 위젯 얻기 →</span>
      </a>

      <a href="/link/" class="card flex-1 bg-base-100 p-7 shadow-lg transition-transform hover:-translate-y-1">
        <div class="mb-2 text-4xl">🎧</div>
        <span class="badge badge-warning mb-3 font-bold tracking-wide">VIEWER</span>
        <h2 class="mb-2 text-xl font-bold">시청자이신가요?</h2>
        <p class="mb-5 min-h-[3rem] text-sm leading-relaxed opacity-70">
          스트리머의 채팅에서 DJ CLASS를 연동하려면 이 쪽을 클릭해주세요.
        </p>
        <span class="btn btn-warning btn-block">DJ CLASS 연동하기 →</span>
      </a>
    </div>

    <footer class="space-y-2 pt-8 text-sm opacity-60">
      <div>Special Thanks to
        <a href="https://chzzk.naver.com/1906dd57f578c255feca54700bcccfc9" target="_blank" rel="noopener noreferrer" class="link">똘똘똘이 님</a>
      </div>
      <a href="https://github.com/FelisCatusKR/chzzk-djclass-chat" target="_blank" rel="noopener noreferrer" class="link">GitHub</a>
      <p class="pt-2 text-xs opacity-50">본 프로젝트는 DJMAX RESPECT V와 공식적인 연관이 없는 비공식 팬 프로젝트입니다.</p>
    </footer>
  </div>
</main>
{% endblock %}
```

- [ ] **Step 5: URLs.** Create `djclass_overlay/streamers/urls.py`:

```python
from django.urls import path

from . import views

urlpatterns = [
    path("", views.landing, name="landing"),
]
```

In `config/urls.py`, add the streamers include **before** the users include (so `""` landing resolves at root):

```python
    path("", include("djclass_overlay.streamers.urls")),
```

> `users.urls` has no root `""` route, so ordering is safe; keep `admin/`, `users`, `overlay` includes.

- [ ] **Step 6: Run — expect pass.** `uv run pytest djclass_overlay/streamers/tests/test_pages.py -q`

- [ ] **Step 7: Commit.**

```bash
git add djclass_overlay/streamers/views.py djclass_overlay/streamers/urls.py \
        djclass_overlay/templates/pages/landing.html \
        djclass_overlay/streamers/tests/test_pages.py config/urls.py
git commit -m "feat(pages): landing page with streamer/viewer fork (daisyUI)"
```

---

### Task 3: Login page restyle + context copy — TDD

Plan 4 created a bare `login.html` + `login_page` view. Add the context-aware copy and daisyUI styling. Reproduce the Node behavior: copy varies by `next`; redirect away if already authed (Plan 4's view already redirects authed users to `/dashboard/`).

**Files:**
- Modify: `djclass_overlay/users/views.py` (`login_page` — add `context` to template), `djclass_overlay/templates/users/login.html`, `djclass_overlay/users/tests/test_session_views.py` (add cases)

- [ ] **Step 1: Add failing tests** (append to `djclass_overlay/users/tests/test_session_views.py`):

```python
def test_login_page_context_copy_dashboard(client):
    resp = client.get("/login/", {"next": "/dashboard/"})
    body = resp.content.decode()
    assert "로그인이 필요해요" in body
    assert "위젯 설정을 위해" in body
    assert "Chzzk로 로그인" in body


def test_login_page_context_copy_link(client):
    resp = client.get("/login/", {"next": "/link/"})
    assert "DJ CLASS 연동을 위해" in resp.content.decode()


def test_login_page_no_context_copy_default(client):
    resp = client.get("/login/")
    body = resp.content.decode()
    assert "Chzzk 계정으로 로그인해주세요" in body
    assert "위젯 설정을 위해" not in body
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/users/tests/test_session_views.py -q`

- [ ] **Step 3: Update `login_page`** in `djclass_overlay/users/views.py` to pass the context label. Replace the existing `login_page` body so it computes `context` from the safe `next`:

```python
def login_page(request):
    if request.user.is_authenticated:
        return redirect("/dashboard/")
    next_path = safe_next_path(request.GET.get("next"))
    context = {
        "/dashboard/": "위젯 설정을 위해",
        "/link/": "DJ CLASS 연동을 위해",
    }.get(next_path)
    return render(request, "users/login.html", {"next": next_path, "context": context})
```

> `safe_next_path` and `redirect`/`render` are already imported in this file (Plan 4). Keep the rest of the view unchanged.

- [ ] **Step 4: Template** (`djclass_overlay/templates/users/login.html`):

```html
{% extends "base.html" %}
{% block title %}로그인{% endblock %}
{% block content %}
<main class="flex min-h-screen items-center justify-center px-4 py-8 sm:py-12">
  <div class="card w-full max-w-sm bg-base-100 p-8 text-center shadow-lg">
    <div class="mb-4 text-4xl">🔒</div>
    <h1 class="mb-2 text-xl font-bold">로그인이 필요해요</h1>
    <p class="mb-6 text-sm leading-relaxed opacity-70">
      {% if context %}<b class="opacity-100">{{ context }}</b><br />{% endif %}
      Chzzk 계정으로 로그인해주세요.
    </p>
    <a href="{% url 'chzzk_login' %}?next={{ next|urlencode }}" class="btn btn-neutral btn-block">Chzzk로 로그인</a>
    <a href="/" class="mt-4 block text-xs opacity-60 hover:opacity-100">← 메인으로 돌아가기</a>
  </div>
</main>
{% endblock %}
```

- [ ] **Step 5: Run — expect pass** (the new cases + Plan 4's existing login tests). `uv run pytest djclass_overlay/users/tests/test_session_views.py -q`

- [ ] **Step 6: Commit.**

```bash
git add djclass_overlay/users/views.py djclass_overlay/templates/users/login.html djclass_overlay/users/tests/test_session_views.py
git commit -m "feat(pages): login page restyle + context-aware copy (daisyUI)"
```

---

### Task 4: `/link` placeholder (full page → Plan 7) — TDD

The landing's viewer card points to `/link`. Until Plan 7 builds the real V-ARCHIVE linking, ship a minimal login-gated "준비 중" placeholder so the link isn't dead.

**Files:**
- Create: `djclass_overlay/viewers/urls.py`, `djclass_overlay/templates/pages/link_placeholder.html`, `djclass_overlay/viewers/tests/test_pages.py`
- Modify: `djclass_overlay/viewers/views.py`, `config/urls.py`

- [ ] **Step 1: Write the failing test** (`djclass_overlay/viewers/tests/test_pages.py`):

```python
import pytest

from djclass_overlay.users.models import User

BACKEND = "djclass_overlay.users.backends.ChzzkBackend"


def test_link_requires_login(client):
    resp = client.get("/link/")
    assert resp.status_code == 302
    assert "/login/" in resp["Location"]
    assert "next=/link/" in resp["Location"]


@pytest.mark.django_db
def test_link_placeholder_renders_for_authed(client):
    u = User.objects.create_user(chzzk_id="v1", chzzk_nickname="Viewer")
    client.force_login(u, backend=BACKEND)
    resp = client.get("/link/")
    assert resp.status_code == 200
    assert "준비 중" in resp.content.decode()
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/viewers/tests/test_pages.py -q`

- [ ] **Step 3: View** (`djclass_overlay/viewers/views.py`):

```python
from django.contrib.auth.decorators import login_required
from django.shortcuts import render


@login_required
def link_page(request):
    # Full V-ARCHIVE linking lands in Plan 7 (needs the V-ARCHIVE client + sync).
    return render(request, "pages/link_placeholder.html")
```

- [ ] **Step 4: Template** (`djclass_overlay/templates/pages/link_placeholder.html`):

```html
{% extends "base.html" %}
{% block title %}DJ CLASS 연동{% endblock %}
{% block content %}
<main class="flex min-h-screen items-center justify-center px-4 py-8 sm:py-12">
  <div class="card w-full max-w-sm bg-base-100 p-8 text-center shadow-lg">
    <div class="mb-4 text-4xl">🎧</div>
    <h1 class="mb-2 text-xl font-bold">DJ CLASS 연동</h1>
    <p class="mb-6 text-sm leading-relaxed opacity-70">
      {{ user.chzzk_nickname }}님, 연동 기능은 <b class="opacity-100">준비 중</b>입니다. 곧 제공될 예정이에요.
    </p>
    <a href="/" class="btn btn-ghost btn-sm">← 메인으로</a>
  </div>
</main>
{% endblock %}
```

- [ ] **Step 5: URLs.** Create `djclass_overlay/viewers/urls.py`:

```python
from django.urls import path

from . import views

urlpatterns = [
    path("link/", views.link_page, name="link"),
]
```

In `config/urls.py` add (alongside the others):

```python
    path("", include("djclass_overlay.viewers.urls")),
```

- [ ] **Step 6: Run — expect pass.** `uv run pytest djclass_overlay/viewers/tests/test_pages.py -q`

- [ ] **Step 7: Commit.**

```bash
git add djclass_overlay/viewers/views.py djclass_overlay/viewers/urls.py \
        djclass_overlay/templates/pages/link_placeholder.html \
        djclass_overlay/viewers/tests/test_pages.py config/urls.py
git commit -m "feat(pages): login-gated /link placeholder (full page in Plan 7)"
```

---

### Task 5: Widget visual polish — rank colors + glint + opacity (completes Plan 5 deferral)

Apply `badge.css` (Task 1) to the real OBS widget: color each badge by its short rank, glint on theory, dim unverified rows. The badge text logic is unchanged; only presentation. No Python change (the SSE event already carries `rank`/`isTheory`).

**Files:**
- Modify: `djclass_overlay/templates/overlay/widget.html` (link `badge.css`, drop now-duplicated inline badge styles), `djclass_overlay/static/overlay/widget.js`

- [ ] **Step 1: Link `badge.css` in the widget** and remove the inline `.badge`/`.row`/`.fading` rules now provided by `badge.css`. In `djclass_overlay/templates/overlay/widget.html`, inside `<head>` add (the overlay needs ONLY badge.css, not the daisyUI CDN):

```html
    {% load static %}
    <link rel="stylesheet" href="{% static 'css/badge.css' %}" />
```

Remove the inline `<style>` rules for `.badge`, `.badge.unverified`, `.row`, `.row.fading` (keep the transparent-body / `#chat` layout rules). Keep `.emoji` and `#status`.

- [ ] **Step 2: Update `widget.js`** to apply the badge classes. Replace the `addMessage` function so a linked badge gets `dj-badge rank-<rank>` (+ `shiny` and a phase-locked `--glint-delay` when `isTheory`), unverified gets `dj-badge unverified`, and an unverified row dims:

```javascript
  var GLINT_PERIOD_MS = 2600; // dj-class.ts GLINT_PERIOD_MS
  function glintDelayMs(now) {
    var offset = now % GLINT_PERIOD_MS;
    return offset === 0 ? 0 : -offset;
  }

  function addMessage(msg) {
    var row = document.createElement("div");
    row.className = "row";
    row.dataset.created = String(Date.now());

    if (msg.status === "linked" && msg.badge) {
      var badge = msg.badge[BUTTON_SEL];
      var b = document.createElement("span");
      b.className = "dj-badge rank-" + badge.rank + (badge.isTheory ? " shiny" : "");
      if (badge.isTheory) {
        b.style.setProperty("--glint-duration", GLINT_PERIOD_MS + "ms");
        b.style.setProperty("--glint-delay", glintDelayMs(Date.now()) + "ms");
      }
      b.textContent = badgeText(badge);
      row.appendChild(b);
    } else if (msg.status === "unlinked" || msg.status === "unsynced") {
      row.classList.add("unverified-row");
      var u = document.createElement("span");
      u.className = "dj-badge unverified";
      u.textContent = "미인증";
      row.appendChild(u);
    }

    var text = document.createElement("span");
    appendContent(text, msg.text, msg.emojis);
    row.appendChild(text);

    chat.appendChild(row);
    while (chat.childElementCount > 100) chat.removeChild(chat.firstChild);
    chat.scrollTop = chat.scrollHeight;
  }
```

> This replaces the existing `addMessage` (which used a plain `.badge`). `badgeText`, `appendContent`, `BUTTON_SEL`, the fadeout loop, and the EventSource wiring are unchanged. The fadeout loop adds `.fading`; `badge.css` handles `.row.fading`/`.row.unverified-row` opacity.

- [ ] **Step 3: Verify.** No unit test for the visual result (it's verified in Task 8's live check). Run the suite to confirm no regression: `uv run pytest -q` (still 85).

- [ ] **Step 4: Commit.**

```bash
git add djclass_overlay/templates/overlay/widget.html djclass_overlay/static/overlay/widget.js
git commit -m "feat(overlay): badge rank colors + theory glint + dim unverified (Plan 5 polish)"
```

---

### Task 6: Dashboard configurator (Alpine, no preview yet) — TDD

The streamer dashboard: 2-pane daisyUI layout, 4 config cards, client-side URL builder + copy + OBS collapse, logout. The widget base URL comes from the logged-in channel (no API). Live preview is added in Task 7.

**Files:**
- Modify: `djclass_overlay/users/views.py` (`dashboard` — pass `widget_base_url`), `djclass_overlay/templates/users/dashboard.html`, `djclass_overlay/users/tests/test_session_views.py`

- [ ] **Step 1: Add failing tests** (append to `djclass_overlay/users/tests/test_session_views.py`):

```python
@pytest.mark.django_db
def test_dashboard_shows_config_and_widget_base_url(client, settings):
    from djclass_overlay.streamers.models import Channel

    settings.BASE_URL = "https://app.test"
    u = User.objects.create_user(chzzk_id="chanX", chzzk_nickname="Streamer")
    Channel.objects.create(user=u, chzzk_channel_id="chanX")
    client.force_login(u, backend=BACKEND)
    resp = client.get("/dashboard/")
    body = resp.content.decode()
    assert resp.status_code == 200
    assert "채팅 위젯 설정" in body
    assert "뱃지 모드" in body and "글자 크기" in body
    assert "버튼 선택 모드" in body and "비활성 채팅 페이드아웃" in body
    assert "OBS 설정 방법" in body
    assert "https://app.test/widget/chanX/" in body  # widget base URL for Alpine
```

> `BACKEND` and `User` are already imported at the top of this test file (Plan 4 / Task 3).

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/users/tests/test_session_views.py -q`

- [ ] **Step 3: Update `dashboard`** in `djclass_overlay/users/views.py`. Add `from django.conf import settings` to the imports if not present, then:

```python
@login_required
def dashboard(request):
    channel = getattr(request.user, "channel", None)
    widget_base_url = ""
    if channel:
        widget_base_url = f"{settings.BASE_URL}/widget/{channel.chzzk_channel_id}/"
    return render(request, "users/dashboard.html", {"widget_base_url": widget_base_url})
```

> `request.user.channel` is the reverse OneToOne from `streamers.Channel` (Plan 2/4). An OAuth-logged-in streamer always has one.

- [ ] **Step 4: Template** (`djclass_overlay/templates/users/dashboard.html`) — daisyUI 2-pane + Alpine `x-data` building the URL client-side. The preview card is a placeholder filled in Task 7:

```html
{% extends "base.html" %}
{% block title %}채팅 위젯 설정{% endblock %}
{% block content %}
<main class="flex min-h-screen flex-col items-center px-4 py-8 sm:py-12">
  <div class="w-full max-w-5xl space-y-6"
       x-data="widgetConfig('{{ widget_base_url|escapejs }}')">
    <h1 class="text-center text-3xl font-bold">채팅 위젯 설정</h1>

    <div class="grid gap-6 lg:grid-cols-[1.7fr_1fr] lg:items-start">
      <!-- LEFT: config (masonry) -->
      <div class="columns-1 gap-4 sm:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <div class="card bg-base-100 p-5 shadow">
          <h2 class="card-title text-base">뱃지 모드</h2>
          <p class="mb-2 text-sm opacity-70">위젯에 표시할 DJ CLASS 뱃지 스타일을 선택하세요.</p>
          <div class="space-y-2">
            <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-base-300 p-3">
              <input type="radio" name="mode" value="short" class="radio radio-sm" x-model="mode" />
              <span class="text-sm font-medium">짧은 이름 (4B SS II)</span>
            </label>
            <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-base-300 p-3">
              <input type="radio" name="mode" value="threshold" class="radio radio-sm" x-model="mode" />
              <span class="text-sm font-medium">근사 파워 (4B 9800+)</span>
            </label>
            <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-base-300 p-3">
              <input type="radio" name="mode" value="power" class="radio radio-sm" x-model="mode" />
              <span class="text-sm font-medium">정수 파워 (4B 9823)</span>
            </label>
          </div>
        </div>

        <div class="card bg-base-100 p-5 shadow">
          <h2 class="card-title text-base">글자 크기</h2>
          <p class="mb-2 text-sm opacity-70">위젯 채팅 글자 크기를 선택하세요.</p>
          <input type="range" min="12" max="28" step="1" class="range range-sm" x-model.number="fontSize" />
          <p class="mt-2 text-xs opacity-70">현재: <span class="font-semibold" x-text="fontSize + 'px'"></span></p>
        </div>

        <div class="card bg-base-100 p-5 shadow">
          <h2 class="card-title text-base">버튼 선택 모드</h2>
          <p class="mb-2 text-sm opacity-70">시청자별 DJ CLASS를 어떤 버튼 기준으로 표시할지 선택하세요.</p>
          <div class="space-y-2">
            <label class="flex cursor-pointer items-center justify-between rounded-lg border border-base-300 p-3">
              <span class="text-sm font-medium">자동 (최고 클래스)</span>
              <input type="radio" name="buttonSel" value="auto" class="radio radio-sm" x-model="buttonSel" />
            </label>
            <label class="flex cursor-pointer items-center justify-between rounded-lg border border-base-300 p-3">
              <span class="text-sm font-medium">시청자 선택 우선</span>
              <input type="radio" name="buttonSel" value="viewer" class="radio radio-sm" x-model="buttonSel" />
            </label>
          </div>
        </div>

        <div class="card bg-base-100 p-5 shadow">
          <h2 class="card-title text-base">비활성 채팅 페이드아웃</h2>
          <p class="mb-2 text-sm opacity-70">일정 시간이 지난 메시지를 서서히 사라지게 합니다.</p>
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-medium">페이드아웃 사용</span>
            <input type="checkbox" class="toggle toggle-sm" x-model="fadeoutOn" />
          </div>
          <input type="range" min="5" max="60" step="1" class="range range-sm" x-model.number="fadeoutSec" :disabled="!fadeoutOn" />
          <p class="mt-2 text-xs opacity-70">현재: <span class="font-semibold" x-text="fadeoutOn ? fadeoutSec + '초' : '꺼짐'"></span></p>
        </div>
      </div>

      <!-- RIGHT: output (sticky) -->
      <div class="space-y-6 lg:sticky lg:top-8">
        {% block preview_card %}
        <div class="card bg-base-100 p-5 shadow">
          <h2 class="card-title text-base">위젯 미리보기</h2>
          <p class="text-sm opacity-70">위젯 URL을 OBS에 추가하면 실제 채팅이 표시됩니다.</p>
        </div>
        {% endblock %}

        <div class="card bg-base-100 p-5 shadow">
          <h2 class="card-title text-base">위젯 URL</h2>
          <p class="mb-3 text-sm opacity-70">OBS Browser Source에 이 URL을 사용하세요.</p>
          <div class="flex gap-2">
            <input type="text" class="input input-bordered input-sm flex-1" :value="widgetUrl()" readonly />
            <button class="btn btn-sm btn-primary" @click="copy()" x-text="copied ? '복사됨!' : 'URL 복사'"></button>
          </div>
          <p class="mt-2 text-xs opacity-60">
            미리보기: <a :href="widgetUrl()" target="_blank" rel="noopener noreferrer" class="link">위젯 열기</a>
          </p>
        </div>

        <div class="card bg-base-100 p-5 shadow">
          <div class="collapse-arrow collapse">
            <input type="checkbox" />
            <div class="collapse-title font-medium">OBS 설정 방법</div>
            <div class="collapse-content">
              <ol class="list-inside list-decimal space-y-1 text-sm opacity-70">
                <li>OBS에서 소스 추가 → 브라우저 선택</li>
                <li>위 URL을 입력하세요</li>
                <li>너비: 400, 높이: 600 권장</li>
                <li>투명도: 사용자 지정 CSS로 배경 투명 설정</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <form method="post" action="{% url 'logout' %}">
        {% csrf_token %}
        <button type="submit" class="btn btn-outline btn-block">로그아웃</button>
      </form>
      <a href="/" class="block text-center opacity-60 hover:opacity-100">← 돌아가기</a>
    </div>
  </div>

  <script>
    function widgetConfig(base) {
      return {
        base: base,
        mode: "short",
        fontSize: 14,
        buttonSel: "auto",
        fadeoutOn: false,
        fadeoutSec: 15,
        copied: false,
        widgetUrl() {
          if (!this.base) return "";
          var u = new URL(this.base, window.location.origin);
          u.searchParams.set("mode", this.mode);
          u.searchParams.set("fontSize", String(this.fontSize));
          if (this.buttonSel === "viewer") u.searchParams.set("buttonSel", "viewer");
          if (this.fadeoutOn) u.searchParams.set("fadeout", String(this.fadeoutSec));
          return u.toString();
        },
        copy() {
          var url = this.widgetUrl();
          if (!url) return;
          navigator.clipboard.writeText(url);
          this.copied = true;
          setTimeout(() => { this.copied = false; }, 2000);
        },
      };
    }
  </script>
</main>
{% endblock %}
```

> The `widgetUrl()` logic mirrors `DashboardPage.tsx:75-84` exactly (mode+fontSize always; buttonSel only when viewer; fadeout only when on). The `{% block preview_card %}` is overridden in Task 7.

- [ ] **Step 5: Run — expect pass.** `uv run pytest djclass_overlay/users/tests/test_session_views.py -q`

- [ ] **Step 6: Commit.**

```bash
git add djclass_overlay/users/views.py djclass_overlay/templates/users/dashboard.html djclass_overlay/users/tests/test_session_views.py
git commit -m "feat(pages): dashboard widget configurator (daisyUI + Alpine URL builder)"
```

---

### Task 7: Dashboard live preview — TDD

Add the animated preview: an Alpine timer cycling fake messages, rendering colored badges (reusing `badge.css` + the same `badgeText`/glint logic as the widget), reacting to `mode`+`fontSize`.

**Files:**
- Create: `djclass_overlay/static/js/widget-preview.js` (fake data + badge text + the Alpine preview component)
- Modify: `djclass_overlay/templates/users/dashboard.html` (load the script; override `preview_card`), `djclass_overlay/users/tests/test_session_views.py`

- [ ] **Step 1: Add a failing test** (append to `djclass_overlay/users/tests/test_session_views.py`):

```python
@pytest.mark.django_db
def test_dashboard_includes_live_preview(client):
    from djclass_overlay.streamers.models import Channel

    u = User.objects.create_user(chzzk_id="chanY", chzzk_nickname="S")
    Channel.objects.create(user=u, chzzk_channel_id="chanY")
    client.force_login(u, backend=BACKEND)
    body = client.get("/dashboard/").content.decode()
    assert "widget-preview.js" in body
    assert 'x-data="widgetPreview' in body
    assert "500~1200ms" in body  # the preview caption
```

- [ ] **Step 2: Run — expect fail.** `uv run pytest djclass_overlay/users/tests/test_session_views.py -q`

- [ ] **Step 3: Preview script** (`djclass_overlay/static/js/widget-preview.js`) — ports `FAKE_CHAT_MESSAGES` (`src/lib/fake-chat-messages.ts`) and the `WidgetPreview` loop. Reuses the same badge-text rules as the widget; the parent dashboard supplies `mode`/`fontSize` via Alpine:

```javascript
/* Dashboard live preview: cycle fake DJ CLASS chat messages. Port of
   src/components/WidgetPreview.tsx + src/lib/fake-chat-messages.ts. Badge colors
   come from badge.css (.dj-badge.rank-*); text from the same rules as widget.js. */
window.FAKE_CHAT_MESSAGES = [
  { rank: "SS", level: "II", power: 9823, button: 4, isTheory: false, text: "안녕하세요" },
  { rank: "SS", level: "I", power: 9888, button: 6, isTheory: false, text: "이거 쉽던데" },
  { rank: "SD", level: "IV", power: 5342, button: 5, isTheory: false, text: "처음 왔어요 잘 부탁드려요" },
  { rank: "PD", level: "III", power: 7337, button: 8, isTheory: false, text: "신청곡 넣어도 되나요?" },
  { rank: "HL", level: "II", power: 9600, button: 6, isTheory: false, text: "망이조아" },
  { rank: "LoD", level: null, power: 10000, button: 4, isTheory: true, text: "ㅎㅇ" },
  { rank: "PRO", level: "II", power: 8800, button: 5, isTheory: false, text: "스코어 인증 완료했습니다" },
  { rank: "AM", level: "III", power: 2800, button: 6, isTheory: false, text: "로페바이럴" },
  { rank: "MM", level: "I", power: 6999, button: 8, isTheory: false, text: "잘 좀 해봐요" },
  { rank: "RK", level: "II", power: 4600, button: 4, isTheory: false, text: "키보드 혹시 뭔가요?" },
  { rank: "BG", level: null, power: 652, button: 5, isTheory: false, text: "이거 좀 어렵..." },
  { rank: "HC", level: "I", power: 8400, button: 6, isTheory: false, text: "오늘도 래더 하시나요?" },
  { rank: "BM", level: "IV", power: 9900, button: 8, isTheory: false, text: "지린다 ㄷㄷ" },
  { rank: "TR", level: "I", power: 2000, button: 4, isTheory: false, text: "반가워요" },
  { rank: "PRO", level: "I", power: 8900, button: 5, isTheory: false, text: "연타를 변기에 넣고 내려" },
  { status: "unverified", text: "ㅁㅁㅁㅁㄷㄴㅅ" },
  { rank: "SD", level: "III", power: 5704, button: 4, isTheory: false, text: "방금 어케 친거임" },
  { rank: "SS", level: "III", power: 9750, button: 8, isTheory: false, text: "퍼펙 ㅊㅊㅊㅊㅊ" },
  { status: "unverified", text: "탭소닉은다시돌아온다" },
  { rank: "RK", level: "I", power: 4943, button: 6, isTheory: false, text: "혹시 제가 연타를 잘 못하는데 이거 방법 있을까요? ㅠㅠ" },
];

window.widgetPreview = function () {
  return {
    rows: [],
    timer: null,
    i: 0,
    init() {
      this.tick();
    },
    tick() {
      var msgs = window.FAKE_CHAT_MESSAGES;
      this.rows.push(msgs[this.i % msgs.length]);
      this.i++;
      if (this.rows.length > 15) this.rows.shift();
      this.$nextTick(() => {
        var el = this.$refs.preview;
        if (el) el.scrollTop = el.scrollHeight;
      });
      var delay = 500 + Math.floor(Math.random() * 700); // 500–1200ms
      this.timer = setTimeout(() => this.tick(), delay);
    },
    destroy() {
      if (this.timer) clearTimeout(this.timer);
    },
    badgeText(m) {
      var prefix = m.button + "B";
      if (this.mode === "power") return prefix + " " + (m.power == null ? 0 : m.power);
      if (this.mode === "threshold") {
        if (m.isTheory) return prefix + " 10000";
        // preview uses class text for the non-theory threshold case (no threshold table client-side)
        return prefix + " " + m.rank + (m.level ? " " + m.level : "");
      }
      return prefix + " " + m.rank + (m.level ? " " + m.level : "");
    },
  };
};
```

> Note: the preview's `threshold` mode shows the rank label rather than the numeric threshold (the threshold table is server-side only). This is a preview approximation — the real widget shows exact thresholds from the SSE event. Acceptable for a styling preview; documented here so it isn't mistaken for a bug.

- [ ] **Step 4: Wire it into the dashboard.** In `djclass_overlay/templates/users/dashboard.html`: (a) add `{% load static %}` at the top (after `{% extends %}`); (b) load the script — add inside the `<script>` area near the bottom: `<script defer src="{% static 'js/widget-preview.js' %}"></script>`; (c) override the preview card block:

```html
{% block preview_card %}
<div class="card bg-base-100 p-5 shadow">
  <h2 class="card-title text-base">위젯 미리보기</h2>
  <p class="mb-3 text-sm opacity-70">실제 위젯 화면 미리보기 (400×200)</p>
  <div x-data="widgetPreview()" x-init="init()"
       class="mx-auto flex h-[200px] w-[400px] flex-col justify-end gap-1 overflow-hidden rounded-lg bg-neutral p-2 text-neutral-content"
       x-ref="preview" :style="`font-size:${fontSize}px`">
    <template x-for="(m, idx) in rows" :key="idx">
      <div class="row" :class="m.status === 'unverified' ? 'unverified-row' : ''">
        <template x-if="m.status === 'unverified'">
          <span class="dj-badge unverified">미인증</span>
        </template>
        <template x-if="m.status !== 'unverified'">
          <span class="dj-badge" :class="'rank-' + m.rank + (m.isTheory ? ' shiny' : '')" x-text="badgeText(m)"></span>
        </template>
        <span x-text="m.text"></span>
      </div>
    </template>
  </div>
  <p class="mt-3 text-center text-xs opacity-60">가짜 채팅 메시지가 500~1200ms 간격으로 자동으로 표시됩니다</p>
</div>
{% endblock %}
```

> The inner `widgetPreview()` component reads `mode`/`fontSize` from the parent `widgetConfig` scope (Alpine child scopes inherit parent data), so changing the badge mode / font size updates the preview live.

- [ ] **Step 5: Run — expect pass.** `uv run pytest djclass_overlay/users/tests/test_session_views.py -q`

- [ ] **Step 6: Full suite + check.** `uv run pytest -q` (all green) and `uv run python manage.py check`.

- [ ] **Step 7: Commit.**

```bash
git add djclass_overlay/static/js/widget-preview.js djclass_overlay/templates/users/dashboard.html djclass_overlay/users/tests/test_session_views.py
git commit -m "feat(pages): dashboard live preview (Alpine fake-chat loop + colored badges)"
```

---

### Task 8: Build + visual verification (owner-driven)

The suite covers page content/structure; this confirms the rendered look + interactivity once.

- [ ] **Step 1: Run.** In the owner's terminal:

```bash
uv run uvicorn config.asgi:application --workers 1 --port 8000
```

- [ ] **Step 2: Walk the pages** (through the tunnel or locally): `/` (landing fork), `/login/?next=/dashboard/` (context copy + Chzzk button), `/dashboard/` (4 config cards adjust the live preview's badge mode + font size; URL field updates; "URL 복사" → "복사됨!"; OBS guide expands; logout works), `/link/` (준비 중 placeholder, login-gated). **Confirm the daisyUI `night` theme + theme-color utilities render via the CDN** (the Task 1 smoke-check), and the badges in the preview show rank colors + the LoD theory glint.

- [ ] **Step 3: Widget polish check.** Open a real widget URL and confirm chat badges now show rank gradient colors, theory badges glint, and unverified rows are dimmed (the Plan 5 deferral, now complete).

- [ ] **Step 4: Record + commit** any theme/copy tweaks. (If swapping the daisyUI theme, change `data-theme` in `base.html` — any theme present in `themes.css`.)

---

## Deferred (documented, not dropped)

- **Plan 7 (sync + viewer link):** the real `/link` page (V-ARCHIVE token input, DJ CLASS sync button, preferred-button radio with per-button badges) + the V-ARCHIVE client + `manage.py sync_djclass`. The placeholder here is replaced then. `validate_preferred_button` (and the per-button badge UI) land with it.
- **Plan 8 (deploy/cutover):** `collectstatic` (for `badge.css` + the preview JS) and the Procfile. If a CSP is added, allow `cdn.jsdelivr.net` for the daisyUI/Tailwind/Alpine CDNs (or self-host those assets then). There is no CSS build step — styling is CDN at runtime.

---

## Self-Review

- **Decisions honored:** stock daisyUI theme (`night`, no frosted reproduction) ✓; daisyUI + Tailwind via the official CDN (no build/Node) ✓; streamer pages + full dashboard, viewer link → Plan 7 ✓.
- **Spec coverage (§4.6):** Django templates + daisyUI ✓; Alpine for the dashboard live preview + URL builder ✓; Django function views ✓; pure-template pages (no django-cotton) ✓; Korean copy reproduced verbatim (landing/login/dashboard strings quoted from the Node source) ✓.
- **No new APIs:** dashboard gets `widget_base_url` from the view context; URL building is client-side Alpine, mirroring `DashboardPage.getWidgetUrl` exactly (mode+fontSize always; buttonSel only viewer; fadeout only on) ✓.
- **Widget polish:** completes Plan 5's deferral via `badge.css` keyed by the short `rank` the SSE event already sends — no Python/SSE change ✓. Glint phase-lock (`glintDelayMs`) ported ✓.
- **Placeholders:** none — every step has complete code. The one approximation (preview's threshold-mode text) is documented, not a gap.
- **Name/route consistency:** routes `/`, `/login/`, `/dashboard/`, `/link/` (trailing slashes, matching existing); `widget_base_url` = `{BASE_URL}/widget/{chzzk_channel_id}/` matches the Plan 5 widget route; badge classes `rank-<short>` match the `rank` field from Plan 5's `build_badge`; `data-theme="night"` is a theme present in daisyUI's `themes.css`.
- **Green-throughout:** suite + `check` run at Tasks 1 and 7; new tests assert rendered content (status, Korean copy, controls, URLs) without depending on CDN styling.
- **Deliverable:** landing + login + a fully interactive dashboard (configurator + live preview) on daisyUI via CDN, plus the polished overlay widget (CDN-free) — no build step, streamer-facing scope, viewer link cleanly deferred to Plan 7.

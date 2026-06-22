# Frontend Polish — app-shell nav (alpine-ajax) + Django 6.0 partials + global Alpine components — Implementation Plan (Plan 6 follow-on)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three frontend-polish improvements on the Plan 6 pages: (1) **smooth, no-flicker navigation** via **alpine-ajax** app-shell (swap a content region instead of full reload — keeps the head/CSS/Alpine, so the Tailwind-browser CDN never re-compiles → no FOUC, Next.js-like transitions); (2) **DRY components** via native **Django 6.0 template partials** (`{% partialdef %}`); (3) move the dashboard's Alpine components to **global `Alpine.data()` registration** so they survive content swaps — which also lets **all scripts move back into `<head>`** (conventional `defer`, no end-of-body `<script>`).

**Architecture:** Already-present Alpine.js gains the `@imacrayon/alpine-ajax` plugin (+ `@alpinejs/morph`). `base.html` becomes an app shell: a persistent `<head>` + a swappable `<main id="content" x-merge="morph">`. Internal navigation links carry `x-target="content"`, so clicking them AJAX-swaps the content region (alpine-ajax updates history). Components (`widgetConfig`, `widgetPreview`) are registered once via `Alpine.data()` in an `alpine:init` listener (a single static `components.js`), so they're available after every swap without re-running per-page scripts. Repeated markup (frosted card, page `<main>` shell) becomes `{% partialdef %}` fragments.

**Tech Stack:** Django 6.0 template partials (built-in), Alpine.js 3.14 + `@imacrayon/alpine-ajax` + `@alpinejs/morph` (all via CDN, plugins-before-core load order), Tailwind/daisyUI via the existing browser CDN, pytest-django (content assertions).

---

> **Why alpine-ajax over HTMX (recorded decision, 2026-06-23):** the app already runs Alpine; alpine-ajax is an Alpine *plugin*, so swapped content is natively Alpine-reactive (no second paradigm, no Alpine-reinit-on-swap friction). The owner suggested it; chosen over HTMX after evaluating both.

> **Browser-verified behavior:** smooth navigation, history/back-forward, and "components survive swaps" are runtime behaviors the unit suite can't assert (tests check content/structure). Each task says what the owner confirms in a browser.

---

### Task 1: Scripts → `<head>` + global `Alpine.data()` registration + install alpine-ajax/morph

Move the per-page inline component scripts to one global registration file, add the alpine-ajax + morph plugins, and put all scripts in `<head>` (defer). No nav behavior yet — this is the foundation (and it fixes the end-of-body `<script>` smell + makes components swap-safe).

**Files:**
- Create: `djclass_overlay/static/js/components.js`
- Delete: `djclass_overlay/static/js/widget-preview.js` (its contents move to `components.js`)
- Modify: `djclass_overlay/templates/base.html`, `djclass_overlay/templates/users/dashboard.html`, `djclass_overlay/users/tests/test_session_views.py`

- [ ] **Step 1: Create `djclass_overlay/static/js/components.js`** — register both components globally via `alpine:init` (move `widgetConfig` from the dashboard inline `<script>` and `widgetPreview` + `FAKE_CHAT_MESSAGES` from `widget-preview.js`):

```javascript
/* Global Alpine component registrations (run before Alpine starts, via alpine:init).
   Registering with Alpine.data() — instead of per-page inline <script>s — means the
   components are available after alpine-ajax content swaps, and lets all scripts live
   in <head>. */
const FAKE_CHAT_MESSAGES = [
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

document.addEventListener("alpine:init", () => {
  Alpine.data("widgetConfig", (base) => ({
    base: base,
    mode: "short",
    fontSize: 14,
    buttonSel: "auto",
    fadeoutOn: false,
    fadeoutSec: 15,
    copied: false,
    widgetUrl() {
      if (!this.base) return "";
      const u = new URL(this.base, window.location.origin);
      u.searchParams.set("mode", this.mode);
      u.searchParams.set("fontSize", String(this.fontSize));
      if (this.buttonSel === "viewer") u.searchParams.set("buttonSel", "viewer");
      if (this.fadeoutOn) u.searchParams.set("fadeout", String(this.fadeoutSec));
      return u.toString();
    },
    copy() {
      const url = this.widgetUrl();
      if (!url) return;
      navigator.clipboard.writeText(url);
      this.copied = true;
      setTimeout(() => { this.copied = false; }, 2000);
    },
  }));

  Alpine.data("widgetPreview", () => ({
    rows: [],
    timer: null,
    i: 0,
    init() { this.tick(); },
    tick() {
      this.rows.push(FAKE_CHAT_MESSAGES[this.i % FAKE_CHAT_MESSAGES.length]);
      this.i++;
      if (this.rows.length > 15) this.rows.shift();
      this.$nextTick(() => {
        const el = this.$refs.preview;
        if (el) el.scrollTop = el.scrollHeight;
      });
      this.timer = setTimeout(() => this.tick(), 500 + Math.floor(Math.random() * 700));
    },
    destroy() { if (this.timer) clearTimeout(this.timer); },
    badgeText(m, mode) {
      const prefix = m.button + "B";
      if (mode === "power") return prefix + " " + (m.power == null ? 0 : m.power);
      if (mode === "threshold") {
        if (m.isTheory) return prefix + " 10000";
        return prefix + " " + m.rank + (m.level ? " " + m.level : "");
      }
      return prefix + " " + m.rank + (m.level ? " " + m.level : "");
    },
  }));
});
```

- [ ] **Step 2: Delete `djclass_overlay/static/js/widget-preview.js`** (contents are now in `components.js`).

- [ ] **Step 3: Update `base.html`** — load all scripts in `<head>` (defer, plugins-before-core order), add `components.js`, and remove the end-of-body Alpine `<script>`. The `<head>` script block becomes:

```html
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/morph@3.14.9/dist/cdn.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/@imacrayon/alpine-ajax@0.12.7/dist/cdn.min.js"></script>
    <script defer src="{% static 'js/components.js' %}"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
```

> Load order matters: `@alpinejs/morph` + `@imacrayon/alpine-ajax` (plugins) and `components.js` (which only attaches an `alpine:init` listener) must all come **before** the Alpine core script. All `defer`, so they execute in document order before `DOMContentLoaded`. Remove the `<script defer ...alpinejs...>` that currently sits at the end of `<body>` (and its comment). Confirm the exact current morph version matches Alpine 3.14.x when implementing (pin a real published `@alpinejs/morph` 3.14.x).

- [ ] **Step 4: Update `dashboard.html`** — remove the inline `<script>function widgetConfig(){…}</script>` block and the `<script defer src="{% static 'js/widget-preview.js' %}">` tag (both now in `components.js`). Leave `x-data="widgetConfig('{{ widget_base_url|escapejs }}')"`, `x-data="widgetPreview()"`, `x-init="init()"`, and all `x-*`/`{% %}` exactly as-is — registered `Alpine.data()` components are invoked the same way.

- [ ] **Step 5: Update the live-preview test.** In `djclass_overlay/users/tests/test_session_views.py`, `test_dashboard_includes_live_preview` asserts `"widget-preview.js" in body` — change that to `"components.js" in body`. Keep the `'x-data="widgetPreview'` and `"500~1200ms"` assertions.

- [ ] **Step 6: Verify.** `uv run pytest -q` (green) + `uv run python manage.py check`. **Owner browser-check:** the dashboard preview still animates, the mode radio changes the badge text, and the font-size slider resizes it (i.e., the global registration works the same as the inline scripts).

- [ ] **Step 7: Commit.**

```bash
git add djclass_overlay/static/js/components.js djclass_overlay/templates/base.html \
        djclass_overlay/templates/users/dashboard.html djclass_overlay/users/tests/test_session_views.py
git rm djclass_overlay/static/js/widget-preview.js
git commit -m "refactor(pages): global Alpine.data registration + scripts in head; add alpine-ajax/morph"
```

---

### Task 2: App-shell + alpine-ajax boosted navigation

Make `base.html` an app shell so internal navigation swaps only the content region (no full reload → no flicker).

**Files:** Modify `djclass_overlay/templates/base.html` + the internal nav links in `landing.html`, `login.html`, `dashboard.html`, `link_placeholder.html`.

- [ ] **Step 1: Wrap content as the swap region** in `base.html`:

```html
  <body class="min-h-screen" x-data>
    <!-- SiteBackground divs stay here (persist across swaps) -->
    ...
    <main id="content" x-merge="morph">{% block content %}{% endblock %}</main>
  </body>
```

> `x-data` on `<body>` gives alpine-ajax an Alpine root. `id="content"` is the swap target; `x-merge="morph"` makes swaps state-preserving (needs the morph plugin from Task 1). Each page's `{% block content %}` must render a single root element inside `#content` (it does — each is a `<main>`/`<div>`; nesting is fine).

- [ ] **Step 2: Boost internal links** — add `x-target="content"` to the in-app navigation links so they swap `#content` instead of full-reloading: the landing cards (`/dashboard/`, `/link/`), the login "← 메인으로 돌아가기" + the dashboard/link "← 돌아가기"/"← 메인으로" links, and the dashboard logout form (or leave logout as a normal POST→redirect). Leave external links (GitHub, Chzzk, V-ARCHIVE) and the Chzzk OAuth login link as normal full navigations (they leave the app — add `x-target="_top"` if needed to force a full load).

> **Implementer: confirm against the alpine-ajax docs** (https://alpine-ajax.js.org or the repo `docs/`) exactly how it manages the URL/history for these link navigations (it should pushState so back/forward + refresh work), and whether `x-target` can be set once on a container and inherited vs. per-link. Adjust the markup to whatever the docs specify for app-shell navigation with history. If alpine-ajax cannot cleanly do history-tracked full-page-style nav, STOP and report — we'd reconsider (e.g. HTMX `hx-boost`).

- [ ] **Step 3: Verify.** `uv run pytest -q` (content tests unaffected — the pages still render `#content` server-side on direct hits) + check. **Owner browser-check (the core of this task):** click between landing → dashboard → back; confirm (a) no white flash / no FOUC (smooth, Next.js-like), (b) the URL updates and browser back/forward + refresh work, (c) the dashboard's Alpine preview still initializes after a swap-in.

- [ ] **Step 4: Commit.**

```bash
git add djclass_overlay/templates/
git commit -m "feat(pages): app-shell boosted navigation via alpine-ajax (smooth transitions)"
```

---

### Task 3: DRY shared markup into Django 6.0 partials

Extract the repeated frosted-card (and the page `<main>` shell) into native `{% partialdef %}` fragments and reuse them.

**Files:** Create `djclass_overlay/templates/partials.html` (or per-component partial files); refactor `landing.html`, `login.html`, `dashboard.html`, `link_placeholder.html`.

- [ ] **Step 1: Define partials.** Using Django 6.0's built-in `{% partialdef %}`, define the shared pieces. Example — a frosted "page card" centered in a `<main>`:

```html
{% partialdef page_card %}
<main class="flex min-h-screen items-center justify-center px-4 py-8 sm:py-12">
  <div class="w-full max-w-sm rounded-2xl border border-white/90 bg-white/70 p-8 text-center shadow-lg backdrop-blur-md">
    {{ slot }}
  </div>
</main>
{% endpartialdef %}
```

> Django 6.0 partials render the surrounding template context. For content injection, prefer the `template_name#partial_name` include form or `{% include %}` of a partial file with context. The implementer picks the cleanest built-in mechanism (partialdef + `{% partial %}`, or a partial template `{% include %}`d with context) to DRY the **login** + **link** cards (near-identical) and the landing/dashboard card chrome — without changing rendered output (the content tests assert the Korean strings/structure, which must stay identical).

- [ ] **Step 2: Refactor** `login.html` and `link_placeholder.html` (the two most similar) to use the shared card partial; factor the landing/dashboard card chrome where it reduces duplication. Keep all Korean copy, `x-*` attrs, `{% url %}`/`{% csrf_token %}`, and `x-target` links identical.

- [ ] **Step 3: Verify.** `uv run pytest -q` — all green (rendered content unchanged). `uv run python manage.py check`.

- [ ] **Step 4: Commit.**

```bash
git add djclass_overlay/templates/
git commit -m "refactor(pages): DRY shared card markup into Django 6.0 template partials"
```

---

### Task 4: Owner verification

- [ ] Restart uvicorn; walk the app: smooth boosted navigation (no flicker), URL/back-forward correct, dashboard preview + controls work after navigating in, and the pages still look right (frosted theme + Pretendard). Record any issues.

---

## Notes / deferred

- First-load FOUC (the Tailwind-browser CDN compiling once on the very first page hit) is **not** removed by app-shell nav (only re-FOUC on navigation is). If that first flash ever matters, the fix is a static CSS build (the Node-free Tailwind build we deferred) — revisit in Plan 8 if desired.
- The `StreamingHttpResponse … synchronous iterators` warning is benign (WhiteNoise static serving), unrelated to this.

## Self-Review

- **Goals:** smooth nav (alpine-ajax app-shell) ✓; DRY components (Django 6.0 partials) ✓; global Alpine registration → scripts in `<head>`, no end-of-body `<script>` ✓ (Task 1).
- **alpine-ajax over HTMX:** recorded rationale (Alpine-native, no reinit friction).
- **Test impact:** only `test_dashboard_includes_live_preview`'s `widget-preview.js`→`components.js` assertion changes; all other content tests stay green (rendered output unchanged). Browser-only behaviors (smooth nav, history, swap-survival) are owner-verified, explicitly flagged per task.
- **Risk flág:** Task 2 Step 2 tells the implementer to confirm alpine-ajax's history/app-shell behavior against its docs and STOP/report if it can't do history-tracked nav cleanly (fallback: HTMX hx-boost).
- **Placeholders:** none — Task 1 has complete code; Tasks 2–3 specify exact edits + the one doc-verification the implementer must do.

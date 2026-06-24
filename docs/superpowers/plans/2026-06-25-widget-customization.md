# 위젯 커스터마이즈 5종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅 오버레이에 가독성(그림자/외곽선)·미인증 반투명 토글·한글 폰트 선택·닉네임 표시(무지개색)·빌더 레이아웃 개편을 추가한다.

**Architecture:** 모두 클라이언트 렌더링 파라미터로 처리한다(서버는 SSE payload에 `nickname` 한 필드만 추가). 오버레이(`widget.html`/`widget.js`/`chat.css`)가 URL 파라미터를 읽어 적용하고, 빌더(`dashboard.html`/`components.js`)가 같은 규칙으로 URL을 조립하고 미리보기를 렌더한다. 새 엔드포인트·DB·CSP 변경 없음.

**Tech Stack:** Django 6 (ASGI), 바닐라 JS(오버레이), Alpine.js + daisyUI + Tailwind(빌더), jsDelivr 웹폰트(Pretendard + fontsource), pytest/ruff/djlint/mypy.

**설계 출처:** `docs/superpowers/specs/2026-06-24-widget-customization-design.md`

## Global Constraints

- Python 3.14, mypy `--strict` (django-stubs), ruff, djlint(`profile=django`, indent 2, H021 무시) — 모두 CI 게이트. 변경 후 통과 필수.
- **CSP 변경 금지.** 폰트는 `cdn.jsdelivr.net`만 사용(이미 `style-src`/`font-src` 허용). Google Fonts 등 타 도메인 금지.
- **JS 단위 테스트 러너 없음.** `widget.js`/`components.js`는 자동 테스트 대신 린트 + 서버 구동 후 브라우저 확인으로 검증. Python(`build_batch`)만 pytest TDD.
- JS 스타일: 기존 파일 그대로 — 세미콜론 없음, 작은따옴표, 2-space. 템플릿은 작업 후 `uv run djlint djclass_overlay/templates --reformat` 적용.
- main은 PR 게이트(브랜치→PR→CI 통과→머지). 작업 브랜치: `feat/widget-customization` (이미 스펙 커밋 있음).
- 무지개 팔레트(8색, 중간 톤 파스텔, 스펙트럼 순): `#f1a7b4 #f0c68a #f2d97e #a7d99b #8ed9c4 #8fc9ec #a3b6ef #c4abe9`.
- 그림자 기본값: `text-shadow: 0 1px 2px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,.9)`.
- 폰트 9종 키: `pretendard`(기본)·`gothic-a1`·`nanum-gothic`·`do-hyeon`·`black-han-sans`·`jua`·`nanum-pen-script`·`gamja-flower`·`nanum-myeongjo`.

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `djclass_overlay/overlay/flush.py` | SSE 배치 빌드 | `BatchMessage`/`build_batch`에 `nickname` |
| `djclass_overlay/overlay/tests/test_flush.py` | flush 테스트 | nickname 단언 추가 |
| `djclass_overlay/static/css/chat.css` | 채팅 표현 스타일(← `badge.css` 리네임) | 리네임 + `.ts-*`/`.dim-unverified`/`.nick` |
| `djclass_overlay/templates/base.html` | 전역 레이아웃 | CSS 참조 갱신 |
| `djclass_overlay/templates/overlay/widget.html` | 오버레이 페이지 | 기본 클래스/폰트, 하드코딩 그림자 제거, CSS 참조 |
| `djclass_overlay/overlay/static/overlay/widget.js` | 오버레이 렌더 | 신규 파라미터·폰트·닉네임·무지개 |
| `djclass_overlay/static/js/components.js` | Alpine 컴포넌트 | widgetConfig/widgetPreview 확장, FAKE 닉네임 |
| `djclass_overlay/templates/users/dashboard.html` | 빌더 | 레이아웃 A + 카드 3장 + 미리보기 바인딩 |

작업 순서: 서버(1) → 오버레이 셸 CSS/HTML(2) → 오버레이 JS(3) → 빌더 로직(4) → 빌더 마크업(5). 각 작업은 독립 커밋.

---

### Task 1: 서버 — SSE payload에 nickname 추가 (TDD)

**Files:**
- Modify: `djclass_overlay/overlay/flush.py` (`BatchMessage` ~31-38, `build_batch` ~57-65)
- Test: `djclass_overlay/overlay/tests/test_flush.py` (`test_build_batch_resolves_and_dedups` ~42-52)

**Interfaces:**
- Produces: `BatchMessage`에 `nickname: str` 필드. 클라이언트(`widget.js` addMessage, Task 3)가 `msg.nickname`을 읽는다.
- Consumes: `registry.ChatMessage["nickname"]` (이미 존재).

- [ ] **Step 1: 실패 테스트 작성** — `test_flush.py`의 `test_build_batch_resolves_and_dedups` 안, `assert len({m["id"] for m in msgs}) == 3` 위에 추가:

```python
    # nickname is forwarded from the raw message (feature 4)
    assert msgs[0]["nickname"] == "N"
    assert msgs[2]["nickname"] == "G"
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest djclass_overlay/overlay/tests/test_flush.py::test_build_batch_resolves_and_dedups -q`
Expected: FAIL — `KeyError: 'nickname'` (payload에 아직 필드 없음)

- [ ] **Step 3: `BatchMessage`에 필드 추가** — `flush.py`의 TypedDict에 `badge` 줄 다음에:

```python
class BatchMessage(TypedDict):
    """One resolved chat line in an SSE `chat` batch (spec §4.4.1)."""

    id: int
    text: str
    emojis: dict[str, str]
    status: str  # mirrors BadgeResult["status"]: linked / unsynced / unlinked
    badge: dict[str, BadgeDict] | None  # mirrors BadgeResult["badge"]
    nickname: str  # raw Chzzk nickname (feature 4; client shows it when nickname=on)
```

- [ ] **Step 4: `build_batch`에서 전달** — appended dict에 `"badge"` 줄 다음에 `"nickname": m["nickname"],` 추가:

```python
        messages.append(
            {
                "id": next(_id_counter),
                "text": m["content"],
                "emojis": m["emojis"],
                "status": res["status"],
                "badge": res["badge"],
                "nickname": m["nickname"],
            }
        )
```

- [ ] **Step 5: 통과 확인 + mypy**

Run: `uv run pytest djclass_overlay/overlay/tests/test_flush.py -q && uv run mypy djclass_overlay/overlay/flush.py`
Expected: PASS, mypy 0 errors (TypedDict 완전성 충족)

- [ ] **Step 6: 커밋**

```bash
git add djclass_overlay/overlay/flush.py djclass_overlay/overlay/tests/test_flush.py
git commit -m "feat(overlay): forward Chzzk nickname in SSE chat payload"
```

---

### Task 2: 오버레이 셸 — CSS 리네임 + 스타일 규칙 + widget.html 기본값

**Files:**
- Rename: `djclass_overlay/static/css/badge.css` → `djclass_overlay/static/css/chat.css`
- Modify: `djclass_overlay/static/css/chat.css` (끝부분 `.row.unverified-row` + 신규 규칙)
- Modify: `djclass_overlay/templates/base.html:37` (참조)
- Modify: `djclass_overlay/templates/overlay/widget.html` (참조·주석·`<style>`·`#chat` 클래스)

**Interfaces:**
- Produces: 전역 CSS 클래스 `.ts-shadow`/`.ts-outline`(텍스트 그림자, 상속), `.dim-unverified` 스코프(미인증 반투명), `.nick`(닉네임). `#chat`는 기본 `class="ts-shadow dim-unverified"`. Task 3(widget.js)·Task 5(preview)가 이 클래스를 토글한다.

- [ ] **Step 1: 파일 리네임 (이력 보존)**

```bash
git mv djclass_overlay/static/css/badge.css djclass_overlay/static/css/chat.css
```

- [ ] **Step 2: `chat.css` 끝부분 수정** — 파일 맨 끝 블록을 아래로 교체:

기존:
```css
.row.unverified-row {
  opacity: 0.75;
}
```
교체:
```css
/* Dimmed only when #chat carries .dim-unverified (the default). The builder can
   disable it via ?dimUnverified=off (feature 2). */
.dim-unverified .row.unverified-row {
  opacity: 0.75;
}

/* Chat text readability (feature 1). text-shadow is an inherited property, so
   setting it on #chat reaches both nickname and message; badges keep their own. */
.ts-shadow {
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 1),
    0 0 4px rgba(0, 0, 0, 0.9);
}
.ts-outline {
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000,
    -1px 0 0 #000,
    1px 0 0 #000,
    0 -1px 0 #000,
    0 1px 0 #000,
    0 0 4px rgba(0, 0, 0, 0.55);
}

/* Rainbow-cycled nickname (feature 4); color is set inline per message. */
.nick {
  font-weight: 700;
  margin-right: 4px;
}
```

- [ ] **Step 3: `base.html:37` 참조 갱신**

```
- <link rel="stylesheet" href="{% static 'css/badge.css' %}" />
+ <link rel="stylesheet" href="{% static 'css/chat.css' %}" />
```

- [ ] **Step 4: `widget.html` 전체 교체** — 새 내용:

```django
{% load static %}

<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DJ CLASS Overlay</title>
    <link rel="stylesheet" href="{% static 'css/chat.css' %}" />
    <style>
      /* Layout-only rules. Badge/row/glint + text styles → chat.css */
      @font-face {
        font-family: "Pretendard";
        src: url("https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/woff2/PretendardVariable.woff2") format("woff2-variations");
        font-weight: 45 920;
        font-display: swap;
      }

      html,
      body {
        margin: 0;
        height: 100%;
        background: transparent;
        overflow: hidden;
      }

      #chat {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        height: 100vh;
        padding: 8px;
        gap: 4px;
        box-sizing: border-box;
        font-family: "Pretendard", system-ui, "Apple SD Gothic Neo", sans-serif;
        color: #fff;
      }

      .emoji {
        height: 1em;
        vertical-align: text-bottom;
      }

      #status {
        position: fixed;
        top: 4px;
        left: 4px;
        font-size: 12px;
        opacity: 0.6;
      }
    </style>
  </head>
  <body>
    <div id="status">채팅 연결 중…</div>
    <div id="chat" class="ts-shadow dim-unverified" data-channel-id="{{ channel_id }}"></div>
    <script src="{% static 'overlay/widget.js' %}"></script>
  </body>
</html>
```

- [ ] **Step 5: 잔존 참조 없음 확인 + 템플릿 린트 + 정적 수집**

Run:
```bash
grep -rn "badge.css" djclass_overlay/templates && echo "STALE REF — FIX" || echo "no stale refs OK"
uv run djlint djclass_overlay/templates --reformat
uv run djlint djclass_overlay/templates --check
uv run djlint djclass_overlay/templates --lint
uv run python manage.py collectstatic --noinput
uv run pytest djclass_overlay/overlay/tests/test_widget_page.py -q
```
Expected: "no stale refs OK"; djlint check/lint 통과; collectstatic 성공; widget_page 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
git add djclass_overlay/static/css/chat.css djclass_overlay/templates/base.html djclass_overlay/templates/overlay/widget.html
git commit -m "refactor(overlay): rename badge.css->chat.css; add text-style/dim/nick rules and widget defaults"
```

---

### Task 3: 오버레이 JS — 파라미터·폰트·닉네임·무지개

**Files:**
- Modify: `djclass_overlay/overlay/static/overlay/widget.js` (전체 교체)

**Interfaces:**
- Consumes: URL 파라미터 `font`/`textStyle`/`nickname`/`dimUnverified`; SSE `msg.nickname`(Task 1); CSS 클래스(Task 2).
- Produces: 없음(말단).

- [ ] **Step 1: `widget.js` 전체 교체** — 새 내용:

```javascript
/* Functional DJ CLASS overlay widget (vanilla JS, no build).
   Consumes the SSE batch stream; assembles badge text per mode from the atomic
   fields the server pre-resolved. Parity helpers ported from
   src/lib/{font-size,fadeout,emoji}.ts and the badge-text rules in dj-class.ts. */
;(function () {
  'use strict'

  var params = new URLSearchParams(location.search)
  var MODE =
    ['short', 'threshold', 'power'].indexOf(params.get('mode')) >= 0
      ? params.get('mode')
      : 'short'
  var BUTTON_SEL = params.get('buttonSel') === 'viewer' ? 'viewer' : 'auto'
  var FONT_SIZE = parseFontSize(params.get('fontSize'))
  var FADEOUT_SEC = parseFadeout(params.get('fadeout'))
  var TEXT_STYLE = params.get('textStyle') === 'outline' ? 'outline' : 'shadow'
  var NICK_ON = params.get('nickname') === 'on'
  var DIM_UNVERIFIED = params.get('dimUnverified') !== 'off'
  var FONT = parseFont(params.get('font'))

  // Korean web fonts on jsDelivr (CSP already allows the host). Pretendard is the
  // default and is loaded via @font-face in widget.html, so its css is null.
  var FONT_MAP = {
    pretendard: { family: 'Pretendard', css: null },
    'gothic-a1': {
      family: 'Gothic A1',
      css: 'https://cdn.jsdelivr.net/npm/@fontsource/gothic-a1/index.css',
    },
    'nanum-gothic': {
      family: 'Nanum Gothic',
      css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-gothic/index.css',
    },
    'do-hyeon': {
      family: 'Do Hyeon',
      css: 'https://cdn.jsdelivr.net/npm/@fontsource/do-hyeon/index.css',
    },
    'black-han-sans': {
      family: 'Black Han Sans',
      css: 'https://cdn.jsdelivr.net/npm/@fontsource/black-han-sans/index.css',
    },
    jua: {
      family: 'Jua',
      css: 'https://cdn.jsdelivr.net/npm/@fontsource/jua/index.css',
    },
    'nanum-pen-script': {
      family: 'Nanum Pen Script',
      css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-pen-script/index.css',
    },
    'gamja-flower': {
      family: 'Gamja Flower',
      css: 'https://cdn.jsdelivr.net/npm/@fontsource/gamja-flower/index.css',
    },
    'nanum-myeongjo': {
      family: 'Nanum Myeongjo',
      css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-myeongjo/index.css',
    },
  }

  // Mid-tone pastels in spectrum order; assigned by message arrival (feature 4).
  var NICK_PALETTE = [
    '#f1a7b4',
    '#f0c68a',
    '#f2d97e',
    '#a7d99b',
    '#8ed9c4',
    '#8fc9ec',
    '#a3b6ef',
    '#c4abe9',
  ]
  var nickColorIdx = 0

  var chat = document.getElementById('chat')
  var statusEl = document.getElementById('status')
  chat.style.fontSize = FONT_SIZE + 'px'
  chat.classList.remove('ts-shadow', 'ts-outline')
  chat.classList.add(TEXT_STYLE === 'outline' ? 'ts-outline' : 'ts-shadow')
  if (!DIM_UNVERIFIED) chat.classList.remove('dim-unverified')
  applyFont(FONT)

  function parseFont(raw) {
    return Object.prototype.hasOwnProperty.call(FONT_MAP, raw)
      ? raw
      : 'pretendard'
  }
  function applyFont(key) {
    var f = FONT_MAP[key]
    if (f.css) {
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = f.css
      document.head.appendChild(link)
    }
    chat.style.fontFamily =
      '"' + f.family + '", "Pretendard", system-ui, "Apple SD Gothic Neo", sans-serif'
  }

  function parseFontSize(raw) {
    // font-size.ts: 12–28, default 14
    if (!raw) return 14
    var n = Number(raw)
    if (!isFinite(n)) return 14
    return Math.min(28, Math.max(12, Math.round(n)))
  }
  function parseFadeout(raw) {
    // fadeout.ts: 5–60, 0<x<5 ⇒ off, none ⇒ off
    if (!raw) return 0
    var n = Number(raw)
    if (!isFinite(n)) return 0
    var r = Math.round(n)
    if (r < 5) return 0
    return Math.min(60, r)
  }

  function badgeText(badge) {
    // dj-class.ts getBadgeText, atomic fields
    var prefix = badge.button + 'B'
    if (MODE === 'power')
      return prefix + ' ' + (badge.power == null ? 0 : badge.power)
    if (MODE === 'threshold') {
      if (badge.isTheory) return prefix + ' 10000'
      if (badge.threshold != null) return prefix + ' ' + badge.threshold + '+'
      return prefix + ' ' + badge.rank
    }
    return prefix + ' ' + badge['class'] // short
  }

  var EMOJI_RE = /\{:([\w-]+):\}/g // emoji.ts parseEmojiContent
  function appendContent(parent, content, emojis) {
    var last = 0,
      m
    EMOJI_RE.lastIndex = 0
    while ((m = EMOJI_RE.exec(content)) !== null) {
      if (m.index > last)
        parent.appendChild(
          document.createTextNode(content.slice(last, m.index))
        )
      var url = emojis && emojis[m[1]]
      if (url) {
        var img = document.createElement('img')
        img.src = url
        img.alt = ''
        img.className = 'emoji'
        img.loading = 'lazy'
        parent.appendChild(img)
      } // unmatched key dropped
      last = m.index + m[0].length
    }
    if (last < content.length)
      parent.appendChild(document.createTextNode(content.slice(last)))
  }

  var GLINT_PERIOD_MS = 2600 // dj-class.ts GLINT_PERIOD_MS
  function glintDelayMs(now) {
    var offset = now % GLINT_PERIOD_MS
    return offset === 0 ? 0 : -offset
  }

  function addMessage(msg) {
    var row = document.createElement('div')
    row.className = 'row'
    row.dataset.created = String(Date.now())

    if (msg.status === 'linked' && msg.badge) {
      var badge = msg.badge[BUTTON_SEL]
      var b = document.createElement('span')
      b.className =
        'dj-badge rank-' + badge.rank + (badge.isTheory ? ' shiny' : '')
      if (badge.isTheory) {
        b.style.setProperty('--glint-duration', GLINT_PERIOD_MS + 'ms')
        b.style.setProperty('--glint-delay', glintDelayMs(Date.now()) + 'ms')
      }
      b.textContent = badgeText(badge)
      row.appendChild(b)
    } else if (msg.status === 'unlinked' || msg.status === 'unsynced') {
      row.classList.add('unverified-row')
      var u = document.createElement('span')
      u.className = 'dj-badge unverified'
      u.textContent = '미인증'
      row.appendChild(u)
    }

    if (NICK_ON && msg.nickname) {
      var nick = document.createElement('span')
      nick.className = 'nick'
      nick.style.color = NICK_PALETTE[nickColorIdx++ % NICK_PALETTE.length]
      nick.textContent = msg.nickname + ':'
      row.appendChild(nick)
    }

    var text = document.createElement('span')
    appendContent(text, msg.text, msg.emojis)
    row.appendChild(text)

    chat.appendChild(row)
    while (chat.childElementCount > 100) chat.removeChild(chat.firstChild) // cap 100
    chat.scrollTop = chat.scrollHeight // pin bottom
  }

  if (FADEOUT_SEC > 0) {
    // two-phase fade: flag, then remove (+500ms)
    setInterval(function () {
      var now = Date.now()
      Array.prototype.slice.call(chat.children).forEach(function (row) {
        var age = now - Number(row.dataset.created || now)
        if (age >= FADEOUT_SEC * 1000 + 500) row.remove()
        else if (age >= FADEOUT_SEC * 1000) row.classList.add('fading')
      })
    }, 250)
  }

  var es = new EventSource('/widget/' + chat.dataset.channelId + '/stream')
  es.onopen = function () {
    statusEl.textContent = ''
  }
  es.onerror = function () {
    statusEl.textContent = '채팅 연결 실패 (재연결 중…)'
  }
  es.addEventListener('chat', function (e) {
    var batch = JSON.parse(e.data)
    ;(batch.messages || []).forEach(addMessage)
  })
})()
```

- [ ] **Step 2: 구문/스타일 점검 + 서버 구동 후 로드**

Run:
```bash
node --check djclass_overlay/overlay/static/overlay/widget.js && echo "JS syntax OK"
uv run python manage.py runserver 8000 &
sleep 3
```
브라우저(또는 헤드리스)로 `http://localhost:8000/widget/test123/?textStyle=outline&font=jua&nickname=on&dimUnverified=off` 로드 →
- 콘솔 에러 없음
- `<head>`에 `@fontsource/jua` `<link>` 주입됨
- `#chat` class에 `ts-outline` 있고 `dim-unverified` 없음, inline `font-family`에 `"Jua"`
Expected: 위 4개 확인 (라이브 채팅 데이터 없으면 행은 비어 있음 — 닉네임 시각 검증은 Task 5 미리보기에서). 확인 후 `kill %1`.

- [ ] **Step 3: 커밋**

```bash
git add djclass_overlay/overlay/static/overlay/widget.js
git commit -m "feat(overlay): font selection, text-style/dim params, nickname with rainbow colors"
```

---

### Task 4: 빌더 로직 — components.js (widgetConfig/widgetPreview/FAKE 닉네임)

**Files:**
- Modify: `djclass_overlay/static/js/components.js` (전체 교체)

**Interfaces:**
- Produces: `widgetConfig` 상태 `font`/`textStyle`/`nicknameOn`/`dimUnverified` + 메서드 `loadFont(key)`/`fontFamily(key)`; `widgetUrl()` 옵셔널 파라미터; `widgetPreview` 행에 `_nickColor`. Task 5 마크업이 이들을 바인딩한다.

- [ ] **Step 1: `components.js` 전체 교체** — 새 내용:

```javascript
/* Global Alpine component registrations (run before Alpine starts, via alpine:init).
   Registering with Alpine.data() — instead of per-page inline <script>s — means the
   components are available after htmx content swaps, and lets all scripts live
   in <head>. */

/* hx-boost history: htmx's default history cache snapshots the LIVE #content
   innerHTML — including Alpine-generated rows and a running widgetPreview — and
   restores that stale snapshot on back/forward WITHOUT firing htmx:afterSettle.
   That left the preview frozen/duplicated after a few back-and-forths. Disabling
   the cache makes back/forward re-fetch fresh server HTML (still an AJAX swap, so
   navigation stays smooth) and re-run the same init path as forward navigation. */
if (window.htmx) window.htmx.config.historyCacheSize = 0

/* Re-init Alpine on htmx-swapped content. afterSettle covers boosted link nav;
   historyRestore covers back/forward (now always a cache-miss server restore).
   initTree skips already-initialised nodes and widgetPreview.init() clears any
   prior timer, so overlapping inits never start a second tick loop. */
function initAlpineTree(e) {
  if (!window.Alpine) return
  const el =
    (e.detail && e.detail.elt) ||
    document.getElementById('content') ||
    document.body
  window.Alpine.initTree(el)
}
document.addEventListener('htmx:afterSettle', initAlpineTree)
document.addEventListener('htmx:historyRestore', initAlpineTree)
/* global Alpine */

// Korean web fonts on jsDelivr (mirrors widget.js FONT_MAP). Pretendard is loaded
// globally via base.html @font-face, so its css is null.
const FONT_MAP = {
  pretendard: { family: 'Pretendard', css: null },
  'gothic-a1': {
    family: 'Gothic A1',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/gothic-a1/index.css',
  },
  'nanum-gothic': {
    family: 'Nanum Gothic',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-gothic/index.css',
  },
  'do-hyeon': {
    family: 'Do Hyeon',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/do-hyeon/index.css',
  },
  'black-han-sans': {
    family: 'Black Han Sans',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/black-han-sans/index.css',
  },
  jua: {
    family: 'Jua',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/jua/index.css',
  },
  'nanum-pen-script': {
    family: 'Nanum Pen Script',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-pen-script/index.css',
  },
  'gamja-flower': {
    family: 'Gamja Flower',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/gamja-flower/index.css',
  },
  'nanum-myeongjo': {
    family: 'Nanum Myeongjo',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-myeongjo/index.css',
  },
}
const NICK_PALETTE = [
  '#f1a7b4',
  '#f0c68a',
  '#f2d97e',
  '#a7d99b',
  '#8ed9c4',
  '#8fc9ec',
  '#a3b6ef',
  '#c4abe9',
]
const loadedFonts = new Set()

// Stand-ins for real SSE badge objects (overlay/badges.py build_badge), so each
// carries the same atomic fields the widget concatenates per mode — including the
// pre-resolved `threshold` (the DJ POWER floor for that rank+level, badges.py
// RANK_THRESHOLDS). Threshold mode renders "<button>B <threshold>+", matching widget.js.
// `nickname` mirrors the SSE payload field added in flush.py (feature 4).
const FAKE_CHAT_MESSAGES = [
  { rank: 'SS', level: 'II', power: 9823, threshold: 9800, button: 4, isTheory: false, nickname: '록담', text: '안녕하세요' },
  { rank: 'SS', level: 'I', power: 9888, threshold: 9850, button: 6, isTheory: false, nickname: '디제이펠리스', text: '이거 쉽던데' },
  { rank: 'SD', level: 'IV', power: 5342, threshold: 5200, button: 5, isTheory: false, nickname: '음악천재', text: '처음 왔어요 잘 부탁드려요' },
  { rank: 'PD', level: 'III', power: 7337, threshold: 7200, button: 8, isTheory: false, nickname: '신청곡요정', text: '신청곡 넣어도 되나요?' },
  { rank: 'HL', level: 'II', power: 9600, threshold: 9600, button: 6, isTheory: false, nickname: '망이조아', text: '망이조아' },
  { rank: 'LoD', level: null, power: 10000, threshold: 9980, button: 4, isTheory: true, nickname: '새벽감성', text: 'ㅎㅇ' },
  { rank: 'PRO', level: 'II', power: 8800, threshold: 8800, button: 5, isTheory: false, nickname: '스코어장인', text: '스코어 인증 완료했습니다' },
  { rank: 'AM', level: 'III', power: 2800, threshold: 2800, button: 6, isTheory: false, nickname: '로페바이럴', text: '로페바이럴' },
  { rank: 'MM', level: 'I', power: 6999, threshold: 6800, button: 8, isTheory: false, nickname: '막귀123', text: '잘 좀 해봐요' },
  { rank: 'RK', level: 'II', power: 4600, threshold: 4600, button: 4, isTheory: false, nickname: '키보드워리어', text: '키보드 혹시 뭔가요?' },
  { rank: 'BG', level: null, power: 652, threshold: 0, button: 5, isTheory: false, nickname: '초보왔어요', text: '이거 좀 어렵...' },
  { rank: 'HC', level: 'I', power: 8400, threshold: 8400, button: 6, isTheory: false, nickname: '래더고수', text: '오늘도 래더 하시나요?' },
  { rank: 'BM', level: 'IV', power: 9900, threshold: 9900, button: 8, isTheory: false, nickname: '지린다', text: '지린다 ㄷㄷ' },
  { rank: 'TR', level: 'I', power: 2000, threshold: 2000, button: 4, isTheory: false, nickname: '반가운손님', text: '반가워요' },
  { rank: 'PRO', level: 'I', power: 8900, threshold: 8900, button: 5, isTheory: false, nickname: '연타마스터', text: '연타를 변기에 넣고 내려' },
  { status: 'unverified', nickname: '익명청취자', text: 'ㅁㅁㅁㅁㄷㄴㅅ' },
  { rank: 'SD', level: 'III', power: 5704, threshold: 5500, button: 4, isTheory: false, nickname: '방금그거', text: '방금 어케 친거임' },
  { rank: 'SS', level: 'III', power: 9750, threshold: 9750, button: 8, isTheory: false, nickname: '퍼펙장인', text: '퍼펙 ㅊㅊㅊㅊㅊ' },
  { status: 'unverified', nickname: '탭소닉팬', text: '탭소닉은다시돌아온다' },
  { rank: 'RK', level: 'I', power: 4943, threshold: 4900, button: 6, isTheory: false, nickname: '연타초보', text: '혹시 제가 연타를 잘 못하는데 이거 방법 있을까요? ㅠㅠ' },
]

document.addEventListener('alpine:init', () => {
  Alpine.data('widgetConfig', (base) => ({
    base: base,
    mode: 'short',
    fontSize: 14,
    buttonSel: 'auto',
    fadeoutOn: false,
    fadeoutSec: 15,
    font: 'pretendard',
    textStyle: 'shadow',
    nicknameOn: false,
    dimUnverified: true,
    copied: false,
    fontFamily(key) {
      const f = FONT_MAP[key] || FONT_MAP.pretendard
      return '"' + f.family + '", "Pretendard", system-ui, sans-serif'
    },
    loadFont(key) {
      const f = FONT_MAP[key]
      if (!f || !f.css || loadedFonts.has(key)) return
      loadedFonts.add(key)
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = f.css
      document.head.appendChild(link)
    },
    widgetUrl() {
      if (!this.base) return ''
      const u = new URL(this.base, window.location.origin)
      if (this.mode !== 'short') u.searchParams.set('mode', this.mode)
      if (this.fontSize !== 14)
        u.searchParams.set('fontSize', String(this.fontSize))
      if (this.buttonSel === 'viewer') u.searchParams.set('buttonSel', 'viewer')
      if (this.fadeoutOn) u.searchParams.set('fadeout', String(this.fadeoutSec))
      if (this.font !== 'pretendard') u.searchParams.set('font', this.font)
      if (this.textStyle !== 'shadow')
        u.searchParams.set('textStyle', this.textStyle)
      if (this.nicknameOn) u.searchParams.set('nickname', 'on')
      if (!this.dimUnverified) u.searchParams.set('dimUnverified', 'off')
      return u.toString()
    },
    copy() {
      const url = this.widgetUrl()
      if (!url) return
      navigator.clipboard.writeText(url)
      this.copied = true
      setTimeout(() => {
        this.copied = false
      }, 2000)
    },
  }))

  Alpine.data('widgetPreview', () => ({
    rows: [],
    timer: null,
    i: 0,
    nickIdx: 0,
    init() {
      // Idempotent: clear any prior tick loop so overlapping inits (htmx swap +
      // Alpine's own observer) never leave two timers pushing rows at once.
      if (this.timer) clearTimeout(this.timer)
      this.rows = []
      this.i = 0
      this.nickIdx = 0
      this.tick()
    },
    tick() {
      const base = FAKE_CHAT_MESSAGES[this.i % FAKE_CHAT_MESSAGES.length]
      // Assign the rainbow color once at push time so it stays stable across
      // re-renders (feature 4: arrival-order cycle, not per-nickname).
      this.rows.push(
        Object.assign({}, base, {
          _nickColor: NICK_PALETTE[this.nickIdx++ % NICK_PALETTE.length],
        })
      )
      this.i++
      if (this.rows.length > 15) this.rows.shift()
      this.$nextTick(() => {
        const el = this.$refs.preview
        if (el) el.scrollTop = el.scrollHeight
      })
      this.timer = setTimeout(
        () => this.tick(),
        500 + Math.floor(Math.random() * 700)
      )
    },
    destroy() {
      if (this.timer) clearTimeout(this.timer)
    },
    badgeText(m, mode) {
      const prefix = m.button + 'B'
      if (mode === 'power')
        return prefix + ' ' + (m.power == null ? 0 : m.power)
      if (mode === 'threshold') {
        if (m.isTheory) return prefix + ' 10000'
        if (m.threshold != null) return prefix + ' ' + m.threshold + '+'
        return prefix + ' ' + m.rank
      }
      return prefix + ' ' + m.rank + (m.level ? ' ' + m.level : '')
    },
  }))
})
```

- [ ] **Step 2: 구문 점검**

Run: `node --check djclass_overlay/static/js/components.js && echo "JS syntax OK"`
Expected: "JS syntax OK" (시각 검증은 Task 5에서 마크업과 함께)

- [ ] **Step 3: 커밋**

```bash
git add djclass_overlay/static/js/components.js
git commit -m "feat(builder): widgetConfig font/text-style/nickname/dim state + preview rainbow + URL optionalization"
```

---

### Task 5: 빌더 마크업 — dashboard.html 레이아웃 A + 카드 + 미리보기 바인딩

**Files:**
- Modify: `djclass_overlay/templates/users/dashboard.html` (전체 교체)

**Interfaces:**
- Consumes: `widgetConfig`/`widgetPreview`(Task 4), 전역 CSS 클래스(Task 2).

- [ ] **Step 1: `dashboard.html` 전체 교체** — 새 내용:

```django
{% extends "base.html" %}

{% block title %}채팅 위젯 설정{% endblock title %}
{% block content %}
  <main class="flex min-h-screen flex-col items-center px-4 py-8 sm:py-12">
    <div class="w-full max-w-5xl space-y-6"
         x-data="widgetConfig('{{ widget_base_url|escapejs }}')">
      <h1 class="text-center text-3xl font-bold text-gray-900">채팅 위젯 설정</h1>
      <!-- Sticky full-width URL bar (feature 5): changing any option updates it live -->
      <div class="sticky top-0 z-20 py-2">
        <div class="frosted-card p-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h2 class="text-base font-bold text-gray-900">위젯 URL</h2>
            <p class="text-xs text-gray-500">옵션을 바꾸면 즉시 반영됩니다 · OBS 브라우저 소스에 사용</p>
          </div>
          <div class="flex gap-2">
            <input type="text"
                   class="input input-bordered input-sm flex-1 font-mono"
                   :value="widgetUrl()"
                   readonly />
            <button class="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-bold text-yellow-400"
                    @click="copy()"
                    x-text="copied ? '복사됨!' : 'URL 복사'"></button>
            <a :href="widgetUrl()"
               target="_blank"
               rel="noopener noreferrer"
               hx-boost="false"
               class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">열기</a>
          </div>
        </div>
      </div>
      <div class="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <!-- LEFT: config (masonry) -->
        <div class="columns-1 gap-4 sm:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          <div class="frosted-card p-5">
            <h2 class="mb-1 text-base font-bold text-gray-900">뱃지 모드</h2>
            <p class="mb-2 text-sm text-gray-600">위젯에 표시할 DJ CLASS 뱃지 스타일을 선택하세요.</p>
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
          <div class="frosted-card p-5">
            <h2 class="mb-1 text-base font-bold text-gray-900">버튼 선택 모드</h2>
            <p class="mb-2 text-sm text-gray-600">시청자별 DJ CLASS를 어떤 버튼 기준으로 표시할지 선택하세요.</p>
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
          <div class="frosted-card p-5">
            <h2 class="mb-1 text-base font-bold text-gray-900">글자 크기</h2>
            <p class="mb-2 text-sm text-gray-600">위젯 채팅 글자 크기를 선택하세요.</p>
            <input type="range" min="12" max="28" step="1" class="range range-sm" x-model.number="fontSize" />
            <p class="mt-2 text-xs text-gray-600">현재: <span class="font-semibold" x-text="fontSize + 'px'"></span></p>
          </div>
          <div class="frosted-card p-5">
            <h2 class="mb-1 text-base font-bold text-gray-900">폰트</h2>
            <p class="mb-2 text-sm text-gray-600">채팅 글꼴을 선택하세요 (한글 지원).</p>
            <select class="select select-bordered select-sm w-full" x-model="font">
              <option value="pretendard">Pretendard (기본)</option>
              <option value="gothic-a1">Gothic A1</option>
              <option value="nanum-gothic">나눔고딕</option>
              <option value="do-hyeon">도현</option>
              <option value="black-han-sans">검은고딕 (Black Han Sans)</option>
              <option value="jua">주아</option>
              <option value="nanum-pen-script">나눔손글씨 펜</option>
              <option value="gamja-flower">감자꽃</option>
              <option value="nanum-myeongjo">나눔명조</option>
            </select>
          </div>
          <div class="frosted-card p-5">
            <h2 class="mb-1 text-base font-bold text-gray-900">가독성 (외곽선)</h2>
            <p class="mb-2 text-sm text-gray-600">밝은 방송 화면에서도 잘 보이도록 글자에 효과를 줍니다.</p>
            <div class="space-y-2">
              <label class="flex cursor-pointer items-center justify-between rounded-lg border border-base-300 p-3">
                <span class="text-sm font-medium">그림자 (기본)</span>
                <input type="radio" name="textStyle" value="shadow" class="radio radio-sm" x-model="textStyle" />
              </label>
              <label class="flex cursor-pointer items-center justify-between rounded-lg border border-base-300 p-3">
                <span class="text-sm font-medium">외곽선</span>
                <input type="radio" name="textStyle" value="outline" class="radio radio-sm" x-model="textStyle" />
              </label>
            </div>
          </div>
          <div class="frosted-card p-5">
            <h2 class="mb-1 text-base font-bold text-gray-900">비활성 채팅 페이드아웃</h2>
            <p class="mb-2 text-sm text-gray-600">일정 시간이 지난 메시지를 서서히 사라지게 합니다.</p>
            <div class="mb-2 flex items-center justify-between">
              <span class="text-sm font-medium">페이드아웃 사용</span>
              <input type="checkbox" class="toggle toggle-sm" x-model="fadeoutOn" />
            </div>
            <input type="range" min="5" max="60" step="1" class="range range-sm" x-model.number="fadeoutSec" :disabled="!fadeoutOn" />
            <p class="mt-2 text-xs text-gray-600">현재: <span class="font-semibold" x-text="fadeoutOn ? fadeoutSec + '초' : '꺼짐'"></span></p>
          </div>
          <div class="frosted-card p-5">
            <h2 class="mb-1 text-base font-bold text-gray-900">표시 옵션</h2>
            <p class="mb-2 text-sm text-gray-600">채팅에 표시할 요소를 선택하세요.</p>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">치지직 닉네임 표시</span>
                <input type="checkbox" class="toggle toggle-sm" x-model="nicknameOn" />
              </div>
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">미인증 채팅 반투명</span>
                <input type="checkbox" class="toggle toggle-sm" x-model="dimUnverified" />
              </div>
            </div>
          </div>
        </div>
        <!-- RIGHT: preview + obs (sticky, offset below the URL bar) -->
        <div class="space-y-6 lg:sticky lg:top-32">
          {% block preview_card %}
            <div class="frosted-card p-5">
              <h2 class="mb-1 text-base font-bold text-gray-900">위젯 미리보기</h2>
              <p class="mb-3 text-sm text-gray-600">실제 위젯 화면 미리보기 (400×340)</p>
              <div x-data="widgetPreview()"
                   x-init="init()"
                   x-effect="loadFont(font)"
                   class="mx-auto flex h-[340px] w-full max-w-[400px] flex-col justify-end gap-1 overflow-hidden rounded-lg bg-gray-900 p-2 text-white"
                   :class="{ 'ts-outline': textStyle === 'outline', 'ts-shadow': textStyle !== 'outline', 'dim-unverified': dimUnverified }"
                   x-ref="preview"
                   :style="{ fontSize: fontSize + 'px', fontFamily: fontFamily(font) }">
                <template x-for="(m, idx) in rows" :key="idx">
                  <div class="row" :class="m.status === 'unverified' ? 'unverified-row' : ''">
                    <template x-if="m.status === 'unverified'">
                      <span class="dj-badge unverified">미인증</span>
                    </template>
                    <template x-if="m.status !== 'unverified'">
                      <span class="dj-badge" :class="'rank-' + m.rank + (m.isTheory ? ' shiny' : '')" x-text="badgeText(m, mode)"></span>
                    </template>
                    <template x-if="nicknameOn">
                      <span class="nick" :style="{ color: m._nickColor }" x-text="m.nickname + ':'"></span>
                    </template>
                    <span x-text="m.text"></span>
                  </div>
                </template>
              </div>
              <p class="mt-3 text-center text-xs text-gray-500">가짜 채팅 메시지가 500~1200ms 간격으로 자동으로 표시됩니다</p>
            </div>
          {% endblock preview_card %}
          <div class="frosted-card p-5">
            <div class="collapse-arrow collapse">
              <input type="checkbox" />
              <div class="collapse-title font-medium text-gray-900">OBS 설정 방법</div>
              <div class="collapse-content">
                <ol class="list-inside list-decimal space-y-1 text-sm text-gray-600">
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
        <form method="post" action="{% url 'logout' %}" hx-boost="false">
          {% csrf_token %}
          <button type="submit" class="btn-chzzk w-full">로그아웃</button>
        </form>
        <a href="/" class="block text-center text-gray-500 hover:text-gray-700">← 돌아가기</a>
      </div>
    </div>
  </main>
{% endblock content %}
```

- [ ] **Step 2: 템플릿 포맷·린트**

Run:
```bash
uv run djlint djclass_overlay/templates --reformat
uv run djlint djclass_overlay/templates --check
uv run djlint djclass_overlay/templates --lint
```
Expected: reformat 적용 후 check/lint 0 errors.

- [ ] **Step 3: 서버 구동 후 시각 검증 (핵심 게이트)**

Run:
```bash
uv run python manage.py runserver 8000 &
sleep 3
```
로그인 후 `http://localhost:8000/dashboard/`(또는 빌더 경로) 로드 → 다음 확인:
- 상단에 **전체 너비 URL 바**, 스크롤해도 고정. 모두 기본값이면 URL에 쿼리 파라미터 없음(`…/widget/<id>/`).
- **폰트** 드롭다운에서 "주아" 선택 → 미리보기 글꼴이 즉시 바뀌고 URL에 `font=jua` 추가.
- **가독성** 외곽선 선택 → 미리보기 글자에 외곽선, URL에 `textStyle=outline`.
- **닉네임 표시** ON → 미리보기에 `닉네임:`이 무지개색으로 순환, URL에 `nickname=on`.
- **미인증 반투명** OFF → 미인증 줄 불투명, URL에 `dimUnverified=off`.
- 우측 미리보기가 더 커지고(340px) 스티키 동작. 콘솔 에러 없음.
확인 후 `kill %1`.

- [ ] **Step 4: 커밋**

```bash
git add djclass_overlay/templates/users/dashboard.html
git commit -m "feat(builder): layout A (sticky URL bar, larger preview) + font/readability/display cards"
```

---

## 최종 통합 검증 (모든 작업 후)

- [ ] 전체 CI 게이트 로컬 재현:

```bash
uv run ruff check djclass_overlay config manage.py
uv run ruff format --check djclass_overlay config manage.py
uv run djlint djclass_overlay/templates --check
uv run djlint djclass_overlay/templates --lint
uv run mypy djclass_overlay config
uv run python manage.py check
uv run python manage.py makemigrations --check --dry-run
uv run pytest -q
uv run python manage.py collectstatic --noinput
```
Expected: 전부 통과(에러 0). 실패 시 해당 작업으로 돌아가 수정.

- [ ] 오버레이 실제 동작(가능하면): 실 채널 ID로 `/widget/<id>/?nickname=on&textStyle=outline&font=do-hyeon` 로드 → 라이브 채팅에 닉네임(무지개색)·외곽선·도현 폰트 적용 확인. (라이브 스트림이 없으면 빌더 미리보기 검증으로 갈음.)

## Self-Review (작성자 체크 — 완료)

1. **스펙 커버리지:** 기능 1=Task 2(.ts-*)+3(param)+5(card) · 기능 2=Task 2(.dim scope)+3(param)+5(toggle) · 기능 3=Task 2(@font-face)+3(FONT_MAP/inject)+4(loadFont)+5(select) · 기능 4=Task 1(payload)+2(.nick)+3(render/palette)+4(FAKE/preview)+5(markup) · 기능 5=Task 5(layout A). CSS 리네임=Task 2. 누락 없음.
2. **플레이스홀더:** 없음(모든 코드 전체 기재).
3. **타입/이름 일관성:** `nickname`(payload·FAKE·렌더) · `FONT_MAP` 키 9종(widget.js=components.js 동일) · `NICK_PALETTE` 8색 동일 · `ts-shadow`/`ts-outline`/`dim-unverified`/`nick` 클래스(chat.css 정의 = widget.js/markup 사용) · widgetConfig 상태명(`font`/`textStyle`/`nicknameOn`/`dimUnverified`)=dashboard 바인딩 일치.

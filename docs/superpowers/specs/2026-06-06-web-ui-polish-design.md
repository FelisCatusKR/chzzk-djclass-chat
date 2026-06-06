# Web UI Polish: Background, Login-First Flow, Onboarding, Bug Fixes

**Date:** 2026-06-06
**Status:** Approved

## Overview

Polish the web-facing pages (landing, login, link, dashboard) of the Chzzk
DJ CLASS widget service. Four independent changes:

1. Apply the DJMAX cover art as a light-frosted page background (web pages only,
   not the OBS widget).
2. Introduce a login-first flow with a dedicated, context-aware `/login` page and
   redirect-back to the originally requested page.
3. Replace the landing page's stacked buttons with two large side-by-side
   onboarding boxes (streamer left, viewer right).
4. Fix two existing warnings: the `url.parse()` deprecation in `server.ts` and the
   missing `allowedDevOrigins` cross-origin dev warning.

The OBS widget route (`/widget/[channelId]`) is explicitly **out of scope** for
all visual changes — it must remain transparent for OBS browser sources.

## 1. Background treatment (light frosted)

**Decision:** Option B from the visual brainstorm — mostly white, with the cover
art faint behind, frosted-glass cards.

- Move `maxresdefault.jpg` from the repo root to `public/cover.jpg`.
- Create a `SiteBackground` component that renders a `fixed inset-0` layer:
  - cover image: `background: url(/cover.jpg) center/cover`, filtered with
    `blur(2px) brightness(1.15)`
  - a white wash overlay: `rgba(248, 248, 250, 0.82)`
  - children render above the layer (`relative z-10` content wrapper)
- Apply `SiteBackground` to the **site pages only**: `/` (landing), `/login`,
  `/link`, `/dashboard`, and `not-found`. Each page's `<main>` drops its
  `bg-gray-50` and renders transparent inside the wrapper.
- The widget route is **not** wrapped and keeps its transparent background.
- Cards adopt the frosted look:
  `bg-white/70 backdrop-blur-md border-white/90 shadow-lg`.

**Implementation note:** Apply the background via the `SiteBackground` wrapper
component inside each page, rather than restructuring routes into a `(site)/`
route group. Lower churn, no file moves; the widget is excluded by simply not
using the wrapper.

## 2. Onboarding (landing page)

Replace the two stacked full-width buttons in `LandingPage.tsx` with **two large
side-by-side boxes**:

- **Streamer box (left):** 🎛️ icon, `STREAMER` role tag, heading
  "스트리머이신가요?", description "내 채팅에 시청자들의 DJ CLASS 뱃지를 표시하는
  위젯을 OBS에 추가하려면 이 쪽을 클릭해주세요.", CTA "채팅 위젯 얻기 →". Links to
  `/dashboard`.
- **Viewer box (right):** 🎧 icon, `VIEWER` role tag, heading "시청자이신가요?",
  description "스트리머의 채팅에서 DJ CLASS를 연동하려면 이 쪽을 클릭해주세요.",
  CTA "DJ CLASS 연동하기 →". Links to `/link`.
- Boxes are frosted cards (same style as §1). Side-by-side on desktop, stacked
  vertically on narrow/mobile screens (`flex-col md:flex-row`).
- Keep the existing title, lead paragraph, and footer (Special Thanks / GitHub).

## 3. Login-first flow

### Dedicated `/login` page
- New page at `src/app/login/page.tsx` rendering a frosted card centered on the
  `SiteBackground`.
- **Context-aware copy** driven by the `next` query param:
  - `next=/link` → "DJ CLASS 연동을 위해 Chzzk 계정으로 로그인해주세요."
  - `next=/dashboard` → "위젯 설정을 위해 Chzzk 계정으로 로그인해주세요."
  - fallback → generic "Chzzk 계정으로 로그인해주세요."
- A "Chzzk로 로그인" button links to `/api/auth/chzzk?next=<next>`.
- A "← 메인으로 돌아가기" link back to `/`.
- If the user is already logged in, redirect straight to `next` (or `/`).

### Server-side gate (not edge middleware)
`src/lib/session.ts` uses `node:crypto` (`createHmac`, `timingSafeEqual`), which
the Next.js Edge runtime cannot execute. Therefore the gate is implemented in
**server components**, which run in the Node runtime:

- Convert `src/app/link/page.tsx` and `src/app/dashboard/page.tsx` to server
  components that:
  1. read the `session` cookie via `cookies()` from `next/headers`,
  2. verify it with `verifySessionCookie`,
  3. on failure, `redirect('/login?next=/link')` (or `/dashboard`).
- The interactive UI stays in the existing client components (`LinkPage`,
  `DashboardPage`), rendered only after the gate passes. No content flicker.

### Redirect-back mechanism
- `src/app/api/auth/chzzk/route.ts` reads `?next=`, **validates it as a safe
  relative path** (must start with a single `/`, reject protocol-relative `//`
  and absolute URLs — open-redirect guard), and stores the validated value in a
  short-lived cookie (e.g. `oauth_next`, `httpOnly`, `sameSite=lax`, 10 min)
  alongside the existing `oauth_state` cookie. Invalid/missing → default `/link`.
- `src/app/api/auth/chzzk/callback/route.ts` reads `oauth_next`, redirects there
  instead of the current hardcoded `/link`, and deletes the `oauth_next` cookie
  (mirroring the existing `oauth_state` cleanup).

### LinkPage simplification
With the gate in place, a user reaching `/link` is always logged in. The "1.
Chzzk에 로그인" card's login-button branch is now dead; collapse that card to a
simple "logged in as {nickname} / 로그아웃" state. Logout still posts to
`/api/auth/logout` and reloads.

### DashboardPage
The existing client-side `fetch('/api/channel')` 401 handler can remain as a
defensive fallback, but should redirect to `/login?next=/dashboard` rather than
straight to `/api/auth/chzzk`, for consistency with the new flow.

## 4. Bug fixes

### `url.parse()` deprecation (DEP0169) in `server.ts`
Replace `parse(req.url!, true)` (from the `url` module) with the WHATWG `URL`
API and pass the shape Next's handler expects:

```ts
const url = new URL(req.url || '/', `http://${req.headers.host}`)
await handle(req, res, {
  pathname: url.pathname,
  search: url.search,
  query: Object.fromEntries(url.searchParams),
})
```

Remove the `import { parse } from 'url'`.

### Cross-origin dev warning
Add `allowedDevOrigins` to `next.config.js`:

```js
const nextConfig = {
  allowedDevOrigins: ['dev-chatoverlay.felis.kr'],
  async headers() { /* unchanged */ },
}
```

## Out of scope

- The OBS widget route (`/widget/[channelId]`) and its appearance.
- Any change to badge rendering, sync logic, or the data model.
- Replacing the OAuth provider or session scheme.

## Testing

- Existing Vitest suite (`session`, `oauth`, etc.) must still pass.
- Add a unit test for the `next` path-safety validation (reject `//evil.com`,
  `https://evil.com`, accept `/link`, `/dashboard`).
- Manual verification: logged-out visit to `/link` and `/dashboard` redirects to
  `/login` with correct context copy; after login, returns to the original page;
  widget page remains transparent and unaffected.

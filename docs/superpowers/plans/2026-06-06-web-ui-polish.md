# Web UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a light-frosted cover-art background to the web pages, add a login-first flow with redirect-back, replace the landing buttons with two side-by-side onboarding boxes, and fix two dev warnings.

**Architecture:** A presentational `SiteBackground` wrapper renders a fixed, blurred cover image under a white wash on the four site pages (the OBS widget is excluded). Auth is gated in Node-runtime server components (not edge middleware, because `session.ts` uses `node:crypto`), which redirect logged-out users to a context-aware `/login` page. A small pure helper validates the `next` redirect target to prevent open redirects, and is reused by the login page and the OAuth init/callback routes.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Vitest, custom Node HTTP server (`server.ts`).

**Note on tests:** This codebase has unit tests for `src/lib/*` only — there is no jsdom/React Testing Library setup, and adding one is out of scope. Therefore only pure logic (the `safeNextPath` helper) is covered by automated tests via TDD; UI/route changes use `npm run lint`, `npm run build`, and manual `npm run dev` verification, matching the existing project pattern.

---

### Task 1: Move cover image and silence the cross-origin dev warning

**Files:**
- Move: `maxresdefault.jpg` → `public/cover.jpg`
- Modify: `next.config.js:34-38`

- [ ] **Step 1: Move the image into `public/`**

Run:
```bash
git mv maxresdefault.jpg public/cover.jpg
```
Expected: the file is staged as a rename. Verify with `git status` showing `renamed: maxresdefault.jpg -> public/cover.jpg`.

- [ ] **Step 2: Add `allowedDevOrigins` to `next.config.js`**

Modify the `nextConfig` object (currently lines 34-38) so it reads:

```js
const nextConfig = {
  allowedDevOrigins: ['dev-chatoverlay.felis.kr'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}
```

- [ ] **Step 3: Verify the dev server starts without the cross-origin warning**

Run: `npm run dev`
Expected: server logs `> Ready on http://0.0.0.0:3000` and, when accessed via `dev-chatoverlay.felis.kr`, no longer prints the `Cross origin request detected ... allowedDevOrigins` warning. Stop the server with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add public/cover.jpg next.config.js
git commit -m "chore: move cover art to public/ and set allowedDevOrigins"
```

---

### Task 2: Replace `url.parse()` in `server.ts` (DEP0169 fix)

**Files:**
- Modify: `server.ts:1-24`

- [ ] **Step 1: Remove the `url` import**

Delete line 2 (`import { parse } from 'url'`).

- [ ] **Step 2: Replace the request handler body with the WHATWG URL API**

Replace the `createServer` callback (currently lines 15-24) with:

```ts
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      await handle(req, res, {
        pathname: url.pathname,
        search: url.search,
        query: Object.fromEntries(url.searchParams),
      })
    } catch (err) {
      console.error('Error handling request:', err)
      res.statusCode = 500
      res.end('Internal server error')
    }
  })
```

- [ ] **Step 3: Verify the deprecation warning is gone and pages still load**

Run: `npm run dev`
Expected: no `[DEP0169] DeprecationWarning: url.parse()` line on startup; `GET /` returns 200 in the browser. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "fix: replace deprecated url.parse() with WHATWG URL API in server"
```

---

### Task 3: `safeNextPath` redirect-target validator (TDD)

**Files:**
- Create: `src/lib/safe-redirect.ts`
- Test: `tests/safe-redirect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/safe-redirect.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { safeNextPath } from '../src/lib/safe-redirect'

describe('safeNextPath', () => {
  it('accepts root-relative paths', () => {
    expect(safeNextPath('/link')).toBe('/link')
    expect(safeNextPath('/dashboard')).toBe('/dashboard')
    expect(safeNextPath('/dashboard?mode=short')).toBe('/dashboard?mode=short')
  })

  it('falls back when next is missing', () => {
    expect(safeNextPath(null)).toBe('/link')
    expect(safeNextPath(undefined)).toBe('/link')
    expect(safeNextPath('')).toBe('/link')
  })

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeNextPath('https://evil.com')).toBe('/link')
    expect(safeNextPath('//evil.com')).toBe('/link')
    expect(safeNextPath('/\\evil.com')).toBe('/link')
    expect(safeNextPath('relative')).toBe('/link')
  })

  it('honours a custom fallback', () => {
    expect(safeNextPath(null, '/dashboard')).toBe('/dashboard')
    expect(safeNextPath('//evil.com', '/dashboard')).toBe('/dashboard')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/safe-redirect.test.ts`
Expected: FAIL — cannot resolve module `../src/lib/safe-redirect`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/safe-redirect.ts`:

```ts
// Validates a `next` redirect target as a safe, same-origin relative path.
// Rejects absolute URLs and protocol-relative ("//host", "/\host") values to
// prevent open redirects. Returns the fallback when next is missing or unsafe.
export function safeNextPath(
  next: string | null | undefined,
  fallback = '/link'
): string {
  if (!next) return fallback
  if (!next.startsWith('/')) return fallback
  // Reject protocol-relative ("//") and backslash tricks ("/\") that browsers
  // may treat as a scheme-relative URL to another host.
  if (next[1] === '/' || next[1] === '\\') return fallback
  return next
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/safe-redirect.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/safe-redirect.ts tests/safe-redirect.test.ts
git commit -m "feat: add safeNextPath redirect-target validator"
```

---

### Task 4: `SiteBackground` wrapper component

**Files:**
- Create: `src/components/SiteBackground.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/SiteBackground.tsx`:

```tsx
import type { ReactNode } from 'react'

// Fixed, light-frosted cover-art background for the web pages.
// Not used by the OBS widget route, which must stay transparent.
export default function SiteBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{
          backgroundImage: 'url(/cover.jpg)',
          filter: 'blur(2px) brightness(1.15)',
          transform: 'scale(1.05)',
        }}
      />
      <div
        aria-hidden
        className="fixed inset-0 -z-10"
        style={{ background: 'rgba(248, 248, 250, 0.82)' }}
      />
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Type-check the component**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/SiteBackground.tsx
git commit -m "feat: add SiteBackground frosted cover-art wrapper"
```

---

### Task 5: Landing page — frosted background + two side-by-side onboarding boxes

**Files:**
- Modify: `src/components/LandingPage.tsx` (full rewrite)

- [ ] **Step 1: Rewrite `LandingPage.tsx`**

Replace the entire file with:

```tsx
import Link from 'next/link'
import SiteBackground from '@/components/SiteBackground'

const FROSTED =
  'rounded-2xl border border-white/90 bg-white/70 shadow-lg backdrop-blur-md'

export default function LandingPage() {
  return (
    <SiteBackground>
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-3xl space-y-8 text-center">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-gray-900">
              Chzzk DJ CLASS 채팅 위젯
            </h1>
            <p className="text-lg text-gray-600">
              V-ARCHIVE의 DJ CLASS를 채팅에 표시하는 OBS 위젯 서비스입니다.
            </p>
          </div>

          <div className="flex flex-col gap-5 md:flex-row">
            <Link
              href="/dashboard"
              className={`${FROSTED} flex-1 p-7 text-center transition-transform hover:-translate-y-1`}
            >
              <div className="mb-2 text-4xl">🎛️</div>
              <span className="mb-3 inline-block rounded-full bg-gray-900 px-3 py-1 text-xs font-bold tracking-wide text-yellow-400">
                STREAMER
              </span>
              <h2 className="mb-2 text-xl font-bold text-gray-900">
                스트리머이신가요?
              </h2>
              <p className="mb-5 min-h-[3rem] text-sm leading-relaxed text-gray-600">
                내 채팅에 시청자들의 DJ CLASS 뱃지를 표시하는 위젯을 OBS에
                추가하려면 이 쪽을 클릭해주세요.
              </p>
              <span className="block rounded-lg bg-gray-900 py-3 text-sm font-bold text-yellow-400">
                채팅 위젯 얻기 →
              </span>
            </Link>

            <Link
              href="/link"
              className={`${FROSTED} flex-1 p-7 text-center transition-transform hover:-translate-y-1`}
            >
              <div className="mb-2 text-4xl">🎧</div>
              <span className="mb-3 inline-block rounded-full bg-yellow-400 px-3 py-1 text-xs font-bold tracking-wide text-gray-900">
                VIEWER
              </span>
              <h2 className="mb-2 text-xl font-bold text-gray-900">
                시청자이신가요?
              </h2>
              <p className="mb-5 min-h-[3rem] text-sm leading-relaxed text-gray-600">
                스트리머의 채팅에서 DJ CLASS를 연동하려면 이 쪽을 클릭해주세요.
              </p>
              <span className="block rounded-lg bg-yellow-500 py-3 text-sm font-bold text-gray-900">
                DJ CLASS 연동하기 →
              </span>
            </Link>
          </div>

          <footer className="space-y-2 pt-8 text-sm text-gray-500">
            <div>
              Special Thanks to{' '}
              <a
                href="https://chzzk.naver.com/1906dd57f578c255feca54700bcccfc9"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
              >
                똘똘똘이 님
              </a>
            </div>
            <a
              href="https://github.com/FelisCatusKR/chzzk-djclass-chat"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-700"
            >
              GitHub
            </a>
            <p className="pt-2 text-xs text-gray-400">
              본 프로젝트는 DJMAX RESPECT V와 공식적인 연관이 없는 비공식 팬
              프로젝트입니다.
            </p>
          </footer>
        </div>
      </main>
    </SiteBackground>
  )
}
```

- [ ] **Step 2: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify the landing page**

Run: `npm run dev`, open `/`. Expected: faint cover art behind a mostly-white page; two frosted boxes side by side (🎛️ Streamer left → `/dashboard`, 🎧 Viewer right → `/link`); boxes stack vertically when the window is narrowed. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/components/LandingPage.tsx
git commit -m "feat: side-by-side onboarding boxes on frosted landing page"
```

---

### Task 6: Dedicated `/login` page (context-aware, already-logged-in shortcut)

**Files:**
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Create the login page**

Create `src/app/login/page.tsx`:

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SiteBackground from '@/components/SiteBackground'
import { verifySessionCookie } from '@/lib/session'
import { safeNextPath } from '@/lib/safe-redirect'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const target = safeNextPath(next ?? null)

  const session = (await cookies()).get('session')?.value
  if (session && verifySessionCookie(session)) {
    redirect(target)
  }

  const context =
    target === '/dashboard'
      ? '위젯 설정을 위해'
      : target === '/link'
        ? 'DJ CLASS 연동을 위해'
        : null

  return (
    <SiteBackground>
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/90 bg-white/70 p-8 text-center shadow-lg backdrop-blur-md">
          <div className="mb-4 text-4xl">🔒</div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">
            로그인이 필요해요
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-gray-600">
            {context ? (
              <>
                <b className="text-gray-900">{context}</b>
                <br />
              </>
            ) : null}
            Chzzk 계정으로 로그인해주세요.
          </p>
          <a
            href={`/api/auth/chzzk?next=${encodeURIComponent(target)}`}
            className="block rounded-lg bg-gray-900 py-3 text-sm font-bold text-yellow-400"
          >
            Chzzk로 로그인
          </a>
          <Link
            href="/"
            className="mt-4 block text-xs text-gray-500 hover:text-gray-700"
          >
            ← 메인으로 돌아가기
          </Link>
        </div>
      </main>
    </SiteBackground>
  )
}
```

- [ ] **Step 2: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, open `/login?next=/link`. Expected: frosted login card showing "DJ CLASS 연동을 위해". Open `/login?next=/dashboard`; expect "위젯 설정을 위해". Stop the server. (Redirect-back is wired in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: add context-aware login page"
```

---

### Task 7: Gate `/link` and `/dashboard` in server components + frosted UI

**Files:**
- Modify: `src/app/link/page.tsx` (full rewrite)
- Modify: `src/app/dashboard/page.tsx` (full rewrite)
- Modify: `src/components/LinkPage.tsx` (wrap in `SiteBackground`, simplify login card)
- Modify: `src/components/DashboardPage.tsx` (wrap in `SiteBackground`, fix 401 redirect)

- [ ] **Step 1: Add the gate to `src/app/link/page.tsx`**

Replace the entire file with:

```tsx
// src/app/link/page.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySessionCookie } from '@/lib/session'
import LinkPage from '@/components/LinkPage'

export default async function Link() {
  const session = (await cookies()).get('session')?.value
  if (!session || !verifySessionCookie(session)) {
    redirect('/login?next=/link')
  }
  return <LinkPage />
}
```

- [ ] **Step 2: Add the gate to `src/app/dashboard/page.tsx`**

Replace the entire file with:

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySessionCookie } from '@/lib/session'
import DashboardPage from '@/components/DashboardPage'

export default async function Dashboard() {
  const session = (await cookies()).get('session')?.value
  if (!session || !verifySessionCookie(session)) {
    redirect('/login?next=/dashboard')
  }
  return <DashboardPage />
}
```

- [ ] **Step 3: Wrap `LinkPage` in `SiteBackground` and simplify the login card**

In `src/components/LinkPage.tsx`:

(a) Add the import after the existing `Link` import (line 4):

```tsx
import SiteBackground from '@/components/SiteBackground'
```

(b) Change the opening of the returned JSX (currently `<main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">`) to:

```tsx
    <SiteBackground>
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
```

and change the matching closing `</main>` at the end of the component to:

```tsx
      </main>
    </SiteBackground>
```

(c) Replace the `CardContent` of the "1. Chzzk에 로그인" card (currently the block rendering either a logout button or an `<a href="/api/auth/chzzk">` login button) with the logged-in-only version, since the page is now gated:

```tsx
          <CardContent>
            <Button className="w-full" variant="outline" onClick={handleLogout}>
              {user?.chzzkNickname
                ? `${user.chzzkNickname}님 로그아웃`
                : '로그아웃'}
            </Button>
          </CardContent>
```

- [ ] **Step 4: Wrap `DashboardPage` in `SiteBackground` and fix the 401 redirect**

In `src/components/DashboardPage.tsx`:

(a) Add the import after the existing `Link` import (line 4):

```tsx
import SiteBackground from '@/components/SiteBackground'
```

(b) Change the 401 handler (currently `window.location.href = '/api/auth/chzzk'` inside the `fetch('/api/channel')` `.then`) to:

```tsx
            window.location.href = '/login?next=/dashboard'
```

(c) The component returns two different `<main>` blocks (the error branch and the main branch). Wrap **both** returned `<main>` elements in `SiteBackground` and drop their `bg-gray-50`:

- Error branch — change `<main className="flex min-h-screen items-center justify-center">` to:

```tsx
      <SiteBackground>
        <main className="flex min-h-screen items-center justify-center px-4">
```
and its closing `</main>` to:
```tsx
        </main>
      </SiteBackground>
```

- Main branch — change `<main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">` to:

```tsx
    <SiteBackground>
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
```
and its closing `</main>` to:
```tsx
      </main>
    </SiteBackground>
```

- [ ] **Step 5: Lint, type-check, and run the full test suite**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: lint clean, no type errors, all tests pass.

- [ ] **Step 6: Manually verify the gate**

Run: `npm run dev`. While logged out (clear the `session` cookie if needed), open `/link` → redirected to `/login?next=/link`; open `/dashboard` → redirected to `/login?next=/dashboard`. No content flash. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add src/app/link/page.tsx src/app/dashboard/page.tsx src/components/LinkPage.tsx src/components/DashboardPage.tsx
git commit -m "feat: gate /link and /dashboard via server components with frosted UI"
```

---

### Task 8: Redirect-back through the OAuth init and callback routes

**Files:**
- Modify: `src/app/api/auth/chzzk/route.ts`
- Modify: `src/app/api/auth/chzzk/callback/route.ts:129-138`

- [ ] **Step 1: Carry `next` through OAuth init**

In `src/app/api/auth/chzzk/route.ts`:

(a) Add the import after the existing logger import (line 5):

```ts
import { safeNextPath } from '@/lib/safe-redirect'
```

(b) After `const url = getOAuthUrl(state)` (line 16), compute the validated next path:

```ts
  const next = safeNextPath(request.nextUrl.searchParams.get('next'))
```

(c) After the existing `response.cookies.set('oauth_state', ...)` block (lines 21-26), add a parallel `oauth_next` cookie:

```ts
  response.cookies.set('oauth_next', next, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  })
```

- [ ] **Step 2: Redirect to `next` from the callback**

In `src/app/api/auth/chzzk/callback/route.ts`:

(a) Add the import after the rate-limit import (line 9):

```ts
import { safeNextPath } from '@/lib/safe-redirect'
```

(b) Replace the success redirect block (currently lines 129-138, the `const response = NextResponse.redirect(new URL('/link', baseUrl))` through `response.cookies.delete('oauth_state')` and `return response`) with:

```ts
    const nextPath = safeNextPath(request.cookies.get('oauth_next')?.value)
    const response = NextResponse.redirect(new URL(nextPath, baseUrl))
    response.cookies.set('session', createSessionCookie(result.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
    response.cookies.delete('oauth_state')
    response.cookies.delete('oauth_next')

    return response
```

- [ ] **Step 3: Lint, type-check, and run tests**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: lint clean, no type errors, all tests pass.

- [ ] **Step 4: Manually verify the full round trip**

Run: `npm run dev`. Logged out, open `/dashboard` → `/login?next=/dashboard` → click "Chzzk로 로그인" → complete Chzzk OAuth → land back on `/dashboard` (not `/link`). Repeat from `/link` and confirm you return to `/link`. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/chzzk/route.ts src/app/api/auth/chzzk/callback/route.ts
git commit -m "feat: redirect back to originally requested page after OAuth login"
```

---

### Task 9: Final verification and docs

**Files:**
- Modify: `README.md` (update streamer/viewer steps to reflect the login-first flow)

- [ ] **Step 1: Production build sanity check**

Run: `npm run build`
Expected: build succeeds with no type errors; `/login`, `/`, `/link`, `/dashboard`, and `/widget/[channelId]` all appear in the route output.

- [ ] **Step 2: Confirm the widget is visually untouched**

Run: `npm run dev`, open a widget URL (e.g. `/widget/<any-channel-id>`). Expected: transparent background, no cover art, no frosted styling. Stop the server.

- [ ] **Step 3: Update the README usage steps**

In `README.md`, update the "스트리머" steps (currently lines 34-44) and "시청자" steps (currently lines 46-52) so the login step reflects that visiting `/dashboard` or `/link` now shows the login page first and returns the user to that page after Chzzk login. For example, replace the streamer step "Chzzk 계정으로 로그인합니다." context so it reads:

```markdown
### 스트리머

1. [대시보드](https://chatoverlay.felis.kr/dashboard)에 접속합니다. 로그인이 필요하면 로그인 페이지로 이동하며, 로그인 후 자동으로 대시보드로 돌아옵니다.
2. Chzzk 계정으로 로그인합니다.
```

and the viewer step similarly for `/link`.

- [ ] **Step 4: Add the non-affiliation disclaimer to the README**

In `README.md`, add a disclaimer line in the "Credit" section (after the Special Thanks paragraph, currently around lines 60-62):

```markdown
> 본 프로젝트는 DJMAX RESPECT V와 공식적인 연관이 없는 비공식 팬 프로젝트입니다.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe login-first flow and add non-affiliation disclaimer"
```

---

## Self-Review Notes

- **Spec coverage:** §1 background → Tasks 1, 4, 5, 6, 7; §2 onboarding → Task 5; §3 login-first (login page → Task 6; server-component gate → Task 7; redirect-back + open-redirect guard → Tasks 3, 8; LinkPage simplification → Task 7) ; §4 bug fixes → Tasks 1, 2; testing requirement (next-path validation test) → Task 3; widget-untouched verification → Task 9.
- **Type consistency:** `safeNextPath(next, fallback?)` signature is used identically in Tasks 6, 8; `SiteBackground` default-exports a `{ children }` component used in Tasks 5, 6, 7; `verifySessionCookie` is the existing export used in Tasks 6, 7.
- **No placeholders:** every code step shows complete code; manual-verification steps name exact URLs and expected results.

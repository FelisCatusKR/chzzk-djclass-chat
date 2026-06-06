# Public-Repo Polish — Design Spec

**Date:** 2026-06-06
**Project:** chzzk-djclass-overlay (Chzzk DJ CLASS chat widget)
**Goal:** Bring the project up to public-repo best practices ahead of open-sourcing it.

## Context & Decisions

The project is a Next.js 15 + TypeScript + SQLite service that overlays V-ARCHIVE
DJ CLASS badges on Chzzk chat for OBS. It is already functional with OAuth, token
encryption, signed sessions, a cron worker, 6 Vitest suites, Docker/Dokku deploy,
a Korean README, AGENTS.md, and an MIT license.

Decisions made during brainstorming:

- **Scope:** All four areas — CI/CD, community/meta files, code & security audit, infra/Docker.
- **Depth:** Deep polish (real source pass, not just packaging).
- **Docs language:** Korean-only (target audience is Korean streamers/viewers).
- **Workflow:** Work directly on `main` (project is unpublished; no feature branch).
- **Crypto fix:** Random per-record salt; reset the local DB (acceptable, unpublished).
- **Docker fix:** Drop `output: 'standalone'`; keep running `tsx server.ts` at runtime.
- **Node version:** Bump from 22 to **24** (current latest LTS). Verified 2026-06-06:
  full 27-test suite passes under Node 24.15.0, `better-sqlite3@12.10.0` native module
  loads under the Node 24 ABI (NODE_MODULE_VERSION 137), entire dependency stack compatible.

## Out of Scope (YAGNI — noted as "future", not built)

English/i18n docs, Postgres migration, metrics/observability, distributed (multi-
instance) rate-limit storage. Recorded in a "향후 과제" section, not implemented.
(Rate limiting and security headers are now **in scope** — see M4/M5.)

---

## Section 0 — Pre-flight (baseline)

`package.json` already restored by the user. Establish a green baseline and record
results before changing anything: `npm install`, `npm run lint`,
`npm run format:check`, `npm test`, `npm run build`.

**Done when:** all five commands pass (or current failures are documented as the starting point).

---

## Section 1 — Repo Meta & Community Files

All user-facing copy in Korean.

- `CONTRIBUTING.md` — setup, env vars, `npm run dev`/`worker`/`test`, mandatory
  `lint:fix` + `format` before commit, PR expectations.
- `SECURITY.md` — private vulnerability-reporting instructions (app handles OAuth
  tokens + encrypted secrets, so this matters), supported versions.
- `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md` (Korean).
- `.github/PULL_REQUEST_TEMPLATE.md` (Korean).
- `.editorconfig` — mirror `.prettierrc` (UTF-8, LF, 2-space, final newline).
- Rename `LICENSE.md` → `LICENSE` (identical MIT content) so GitHub auto-detects it;
  update the README link.
- README: add a badges row (CI status, license, Node 24+).
- Pin the Node version: add an `engines.node` field (`>=24`) to `package.json` and a
  `.nvmrc` (`24`) so contributors and CI use the same runtime.

**Done when:** GitHub "community standards" checklist items exist; license auto-detected.

---

## Section 2 — CI/CD (GitHub Actions)

- `.github/workflows/ci.yml`:
  - Triggers: `push` and `pull_request`.
  - Node 24, `npm ci` with npm cache.
  - Steps: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`.
  - CI env: provide dummy values for required env vars so `build`/tests don't fail
    on missing secrets (no real secrets in CI).
- `.github/dependabot.yml` — weekly updates for `npm` and `github-actions`.

**Done when:** workflow is valid YAML and the job graph runs the four checks on PR/push.

---

## Section 3 — Code & Security Audit + Fixes

Findings from the full source read, by severity. Items marked **Fix** are committed work;
items marked **Note** are documented but not changed unless trivial.

### High

- **H1 — Sessions have no server-verified expiry.** `session.ts` signs only the
  userId; the signed value is valid forever even though the browser cookie has a
  7-day `maxAge`. A leaked/copied cookie value works indefinitely.
  **Fix:** embed an expiry timestamp in the signed payload
  (`userId.exp.signature`), reject expired tokens in `verifySessionCookie`. Keep the
  7-day window to match the existing cookie `maxAge`. Old 2-part cookies become
  invalid → one re-login (fine pre-launch).

### Medium

- **M1 — Static KDF salt in `crypto.ts`.** `scryptSync(key, 'salt', ...)` is
  deterministic with a hardcoded salt.
  **Fix:** generate a random 16-byte salt per `encrypt()`, prepend it to the output
  (`salt | iv | authTag | ciphertext`), read it back in `decrypt()`. Reset the local
  DB since stored ciphertext format changes (no production data exists).
- **M2 — Verbose / secret-adjacent logging.** `chat-proxy.ts`, `chzzk.ts`, and the
  OAuth callback log partial session keys, session URLs, OAuth code/state prefixes,
  and user info at all times.
  **Fix:** introduce a tiny leveled logger (`src/lib/logger.ts`: debug/info/warn/error,
  silent at `debug` in production). Route existing logs through it; remove logging of
  token/session-key/URL fragments entirely. Default production level = `info`.
- **M3 — No timeouts on external fetches.** All `fetch` calls to Chzzk and V-ARCHIVE
  can hang indefinitely.
  **Fix:** add `AbortSignal.timeout(~8s)` to outbound fetches in `chzzk.ts`,
  `varchive.ts`, and `chat-proxy.ts` session/subscribe calls; surface timeout as a
  clean error.
- **M4 — Security headers.** No security headers are currently sent.
  **Fix:** add `async headers()` in `next.config.js` applying a baseline to all routes:
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` (OBS loads widgets as a top-level page, so framing denial is
  safe), `Permissions-Policy` (disable camera/mic/geolocation), and
  `Strict-Transport-Security` in production only. Add a Content-Security-Policy tuned to
  not break Next.js (allow `'self'`; `style-src` may need `'unsafe-inline'` for Next/
  Tailwind runtime styles; `connect-src` must allow the widget's `ws:`/`wss:` WebSocket
  origin). Validate the widget still renders in OBS after applying.
- **M5 — Rate limiting.** Mutating/auth endpoints are unauthenticated-reachable and
  hit external APIs, so they need throttling.
  **Fix:** add `src/lib/rate-limit.ts` — a fixed-window limiter keyed by client IP
  (from `x-forwarded-for`, set by Dokku/nginx; fall back to a connection identifier),
  reusing the existing `lru-cache` dependency for the counter buckets (no new package).
  Apply at the top of sensitive routes — `auth/chzzk` (init), `auth/chzzk/callback`,
  `user/link-varchive`, `user/sync-djclass` — returning HTTP 429 with a Korean message.
  Sensible per-route windows (e.g. link/sync stricter than auth init). Single-instance
  in-memory state is acceptable for the current 1-web deployment; note that a multi-
  instance deployment would need shared storage.

### Low

- **L1 — DB handle leak on error path.** In the OAuth callback, `db` opens inside the
  `try` but `db.close()` only runs on the success path; an exception after open skips
  close. **Fix:** close in a `finally`.
- **L2 — Sequential V-ARCHIVE button lookups.** `getHighestDjClass` awaits 4 buttons
  serially. **Fix:** `Promise.all` the four `getDjClass` calls (still tolerate
  per-button failure).
- **L3 — Consistent API error shape.** API routes return slightly different JSON
  shapes. **Fix:** standardize on `{ error: string, code?: string }` and reuse a small
  helper; keep Korean messages.
- **L4 — Input validation.** Confirm every route that reads request input validates
  it (link-varchive already does). Add checks where missing; no behavior change where
  already present.
- **Note:** OAuth CSRF state validation, env-var validation in the worker, and the
  `connectingPromise` race guard are already correct — leave as-is.

**Done when:** H1, M1–M5, L1–L4 implemented; existing tests still pass; new tests
(Section 6) pass.

---

## Section 4 — Infra / Docker Cleanup

- Bump both Dockerfile stages `node:22-alpine` → `node:24-alpine`; align README
  ("Node.js 24+"), CI, `.nvmrc`, and `package.json` `engines`.
- Remove `output: 'standalone'` from `next.config.js` (it is not used — runtime is
  `tsx server.ts`, required for the WebSocket proxy).
- Update `Dockerfile`: stop copying `.next/standalone`; copy what `tsx server.ts`
  needs (`.next`, `src`, `server.ts`, `package*.json`, prod `node_modules`). Keep
  `CMD ["npm", "start"]`.
- Add a `HEALTHCHECK` hitting the HTTP server.
- Review `.dockerignore`: ensure `data/`, `.next/cache`, `test-data/`, `.env`,
  `node_modules` excluded from build context.
- `.gitignore`: add `test-data/` (currently untracked but not ignored).

**Done when:** `docker build` produces a coherent image that boots `tsx server.ts`;
no dangling standalone references.

---

## Section 5 — Docs Polish (Korean)

- README accuracy pass against the real code: env-var table, npm scripts, API table,
  Dokku deploy steps. Reconcile any drift introduced by Sections 3–4 (e.g. session,
  Docker).
- Add a concise "프로젝트 구조" section.
- Confirm the screenshot still represents current widget UI; regenerate if needed.
- Verify `.env.example` lists every variable the code reads (currently matches; keep
  in sync if Section 3 adds any).
- **AGENTS.md self-update rule:** update AGENTS.md for any changed convention
  (logger, crypto format, Docker, env vars).

**Done when:** README/AGENTS/.env.example match the post-polish codebase.

---

## Section 6 — Testing

Add focused tests for new/changed behavior only (no broad coverage expansion):

- `session.test.ts` — extend: valid within TTL, rejected when expired, rejected when
  tampered, rejected for legacy 2-part format.
- `crypto.test.ts` — extend: round-trip with random salt; two encryptions of the same
  plaintext produce different ciphertext (salt + IV randomness).
- `rate-limit.test.ts` — allows requests under the window limit, returns blocked once
  the limit is exceeded, resets after the window elapses.

**Done when:** new tests pass alongside the existing 6 suites via `npm test`.

---

## Execution Order

0 (pre-flight) → 1, 2 (low-risk additive) → 3 (code/security) → 4 (infra) →
6 (tests for §3) → 5 (docs reconcile last, since it documents §3/§4 outcomes).
Commit in logical chunks on `main`. Run `npm run lint:fix && npm run format && npm test`
before each commit (per AGENTS.md).

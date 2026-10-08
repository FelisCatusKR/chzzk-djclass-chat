# Go cutover runbook

> **Done 2026-10-08.** Production runs the Go server. One fix was needed during the
> switch: the Quadlet `HealthCmd` must be a JSON array — as a string Podman runs it via
> `/bin/sh -c`, which distroless lacks, so the unit never became healthy.

How the Go server replaces Django in production. Everything up to **Switch** is
reversible and leaves production on Django. Host-side changes (Quadlet units,
GitOps build target) live in the private `homelab-infra` repo.

## Verify first

- [x] **Live broadcast run** (2026-10-08): the Go widget ran next to the
      production one in OBS for a real stream — chat and emoji arrived, no
      session drops; after the source closed the worker tore down 30 s later
      and reconnected in ~0.2 s when it reopened. (The worker follows widget
      subscribers, not live status: OBS keeps a loaded source open while
      off-air, so the Chzzk session stays up then — cheap, and chat works the
      moment the next stream starts.)
- [x] **Import rehearsal** (2026-10-08, on rpi-1, Django still serving,
      dumpdata piped straight into `import` — no export file): users 1,276,
      channels 1,276, links 1,005, dj_classes 3,205 — all equal to Postgres;
      all 2,552 Chzzk tokens decrypted with the production key.
- [x] Widget URLs (`/widget/<channelId>/`) and the OAuth callback
      (`/api/auth/chzzk/callback`) are unchanged — OBS sources and the Chzzk
      app config keep working.
- [x] Assets baked into the image (`go-runner` copies them from the Django
      tree at build time); `/healthz` + `djclass healthcheck` for the probe.
- [x] Security headers / CSP (incl. Naver emoji CDN in `img-src`).
- [x] Web container reachable only through cloudflared (no published port;
      rate limiting trusts `CF-Connecting-IP`) — keep it that way.

## Behavior changes vs. Django (intentional)

- Badges match viewers by Chzzk channel id only — the nickname fallback is
  gone (impersonation risk). Viewers without a `senderChannelId` show `미인증`.
- Rate-limited `/link` actions return 429 (Django returned 200).
- Emoji URLs outside Naver's image CDNs are dropped.
- Sessions are not migrated: everyone logs in once more.

## Container contract (Go)

| Item    | Value                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| Build   | `Dockerfile`, target **`go-runner`** (distroless, ~18 MB), no build args                                     |
| Command | image default (`/djclass serve`); migrations run automatically on start                                      |
| Port    | `8000`                                                                                                       |
| Health  | `HealthCmd=/djclass healthcheck` (GET `/healthz` → 200: HTTP up + DB answers)                                |
| State   | **SQLite in a persistent volume at `/data`** (file + `-wal`/`-shm`); runs as uid 65532                       |
| Env     | `BASE_URL`, `CHZZK_CLIENT_ID`; secrets `VARCHIVE_TOKEN_KEY` (**same value as today**), `CHZZK_CLIENT_SECRET` |
| Drops   | `DATABASE_URL`, `DJANGO_SECRET_KEY`, `DJANGO_SETTINGS_MODULE`, `DJANGO_ALLOWED_HOSTS`                        |

Never set `DEV` in production (it is refused for a non-loopback `BASE_URL`).

## Steps

The host-side runbook — exact commands for the rpi-1 Podman/Quadlet setup —
lives in homelab-infra: `docs/runbooks/2026-10-08-chatoverlay-go-cutover.md`
(PR #88 there). In short:

1. **Freeze deploys** (`reconcile.timer`) and pre-build the image as
   `localhost/chatoverlay-go-runner:current` (the name reconcile derives from
   the `go-runner` build target).
2. **Stop the Django web unit** (Postgres stays up) and `dumpdata` the four
   models with the current Django image.
3. **Import** into the `chatoverlay-data` volume with `djclass import -`;
   compare its counts with Postgres. `does not decrypt` = wrong
   `VARCHIVE_TOKEN_KEY` → stop and restart Django.
4. **Switch** by applying the infra branch (new web unit + volume).
5. **Smoke test**: `/healthz`, login → dashboard, `/link/` for an existing
   viewer, OBS widget reconnects by itself, `chat subscription confirmed`.
6. **Clean up** the export, resume deploys, merge the infra PR.

## Rollback

Until Postgres is removed: stop the Go unit, restore the Django unit and the
`runner` build target, start it. Postgres still holds the pre-cutover data;
anything written on the Go side since the switch (new links, syncs, logins)
is lost.

## After a few stable days

- `pg_dump` a final archive, then remove the Postgres unit, volume and the
  Django-only secrets (`DATABASE_URL`, `DJANGO_SECRET_KEY`).
- Repo cleanup PR: remove Django; move `go/` to the repo root; move
  `chat.css` / `components.js` / `widget.js` into the Go tree and embed them
  directly (dropping `components.js`'s hx-boost/initTree workarounds and the
  `DJANGO_DIR` fallback); delete `cmd/spike`; CI becomes mise-only (Go, sqlc,
  Node) with one job — update the branch-protection required check;
  rewrite AGENTS.md / DEPLOY.md / CONTRIBUTING.md for Go.
- Back up `/data` (e.g. Litestream or a periodic `VACUUM INTO` copy off-host).
- [x] Publish the image to GHCR from CI (native amd64/arm64 runners, `main` + `sha-<7>` tags, docs-only commits skipped) so the Pi pulls instead of compiling.

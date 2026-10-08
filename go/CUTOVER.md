# Go cutover runbook

How the Go server replaces Django in production. Everything up to **Switch** is
reversible and leaves production on Django. Host-side changes (Quadlet units,
GitOps build target) live in the private `homelab-infra` repo.

## Verify first

- [ ] **Live broadcast run**: during a real stream, run the Go server's widget
      next to the production widget in OBS (user sessions allow 3 sockets).
      Check real CHAT payloads (emoji URLs, nickname, `senderChannelId`), no
      dropped messages vs. production, and a full broadcast without stalls.
      Expect real viewers to show `미인증` until data is imported.
- [ ] **Import rehearsal** (steps 2–3 below against a scratch volume, Django
      still serving): `import done` reports every token verified and the same
      row counts as Postgres; spot-check a few linked viewers' badges on the
      Go `/link/` page against production.
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

Commands assume the host user running the `chatoverlay` units; adapt names to
the infra repo.

1. **Freeze deploys.** Pause the GitOps poller so no build/restart lands
   mid-cutover.
2. **Stop writes and export.** Stop the Django web unit (keep Postgres up),
   then dump with the current Django image on the app network:

   ```sh
   systemctl --user stop chatoverlay-web
   podman run --rm --network chatoverlay \
     --secret chatoverlay-database-url,type=env,target=DATABASE_URL \
     --secret chatoverlay-django-secret-key,type=env,target=DJANGO_SECRET_KEY \
     --secret chatoverlay-varchive-token-key,type=env,target=VARCHIVE_TOKEN_KEY \
     --secret chatoverlay-chzzk-client-secret,type=env,target=CHZZK_CLIENT_SECRET \
     -e DJANGO_SETTINGS_MODULE=config.settings.production \
     -e BASE_URL=https://chatoverlay.felis.kr -e CHZZK_CLIENT_ID=… \
     localhost/chatoverlay-runner:current \
     python manage.py dumpdata users.user streamers.channel viewers.varchivetoken djclass.djclass \
     > ~/chatoverlay-export.json
   chmod 600 ~/chatoverlay-export.json   # contains encrypted Chzzk tokens
   ```

3. **Build and import.** Build `--target go-runner` from the same commit,
   create the volume, import (refuses a non-empty DB; all-or-nothing):

   ```sh
   podman build --target go-runner -t localhost/chatoverlay-go:current <checkout>
   podman volume create chatoverlay-data
   podman run --rm -i -v chatoverlay-data:/data \
     --secret chatoverlay-varchive-token-key,type=env,target=VARCHIVE_TOKEN_KEY \
     --secret chatoverlay-chzzk-client-secret,type=env,target=CHZZK_CLIENT_SECRET \
     -e BASE_URL=https://chatoverlay.felis.kr -e CHZZK_CLIENT_ID=… \
     localhost/chatoverlay-go:current import - < ~/chatoverlay-export.json
   ```

   Expect `import done … tokens_verified=N` with counts matching Postgres. A
   `does not decrypt` error means the wrong `VARCHIVE_TOKEN_KEY` — stop here.

4. **Switch.** Deploy the Go web unit (infra repo): image
   `chatoverlay-go:current`, `Volume=chatoverlay-data:/data`, no `Exec`, the
   env/secrets above, `HealthCmd=/djclass healthcheck`, no Postgres
   dependency. Start it and wait for `healthy`.
5. **Smoke test** on the public URL: landing; log in → dashboard widget URL;
   OBS source reconnects on its own (widget.js retries after the 502 during
   the switch); `/link/` shows an existing viewer's classes; logs show
   `chat socket connected` / `chat subscription confirmed` for live channels.
6. **Resume deploys** with the GitOps build target set to `go-runner`.
7. **Clean up the export:** `shred -u ~/chatoverlay-export.json`.

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

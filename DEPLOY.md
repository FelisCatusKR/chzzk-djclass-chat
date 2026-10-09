# Deployment

Production runs as a **single container** on a self-hosted rootless Podman host. The
host's wiring (Quadlet units, secrets, tunnel, GitOps reconcile) lives in a separate
private infra repo; this file documents the **contract** the app expects.

Everything — HTTP, the widget SSE streams, the Chzzk chat connections and the daily
DJ CLASS sync (18:00 UTC) — runs in that one process with in-memory state. Run
**exactly one instance.**

## How a change reaches production

1. A PR merges to `main` after the required checks (`build`, `go-image`) pass.
2. CI publishes `ghcr.io/feliscatuskr/chzzk-djclass-chat` for that commit — tags
   `main` and `sha-<7>`, `linux/amd64` + `linux/arm64`. Docs-only commits (`*.md`,
   `docs/`) are not published.
3. The host polls the `main` tag and, when the image's
   `org.opencontainers.image.revision` changes, restarts the container and waits for
   it to become healthy. Open OBS widgets reconnect by themselves.

Rollback: pin the previous `sha-<7>` tag on the host.

## Container contract

| Item    | Value                                                                                      |
| ------- | ------------------------------------------------------------------------------------------ |
| Image   | `Dockerfile` target `go-runner` — static binary on distroless Debian 13 (~18 MB)           |
| Command | image default (`/djclass serve`); SQLite migrations apply automatically on start           |
| Port    | `8000` (plain HTTP; TLS terminates at the Cloudflare Tunnel in front)                      |
| Health  | `/djclass healthcheck` → `GET /healthz` (HTTP up + DB answers)                             |
| State   | SQLite at `/data/djclass.sqlite3` (+ `-wal`/`-shm`) — mount a persistent volume on `/data` |
| User    | uid 65532 (`nonroot`); the image's `/data` is owned by it                                  |

> Podman builds/stores images in OCI format, which **drops the Dockerfile
> `HEALTHCHECK`**. Declare it on the container, and as an **exec-form JSON array**
> (Quadlet: `HealthCmd=["/djclass","healthcheck"]`) — a plain string is run through
> `/bin/sh -c`, and distroless has no shell, so the container never turns healthy.

## Environment

| Variable              | Notes                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BASE_URL`            | `https://<public-domain>` — OAuth redirect_uri, widget URLs; https enables Secure cookies + HSTS                                                 |
| `CHZZK_CLIENT_ID`     |                                                                                                                                                  |
| `CHZZK_CLIENT_SECRET` | secret                                                                                                                                           |
| `VARCHIVE_TOKEN_KEY`  | secret; encrypts stored Chzzk tokens. **Set once and keep it**: changing it makes every stored token undecryptable (streamers must log in again) |
| `SQLITE_PATH`, `ADDR` | image defaults `/data/djclass.sqlite3`, `:8000`                                                                                                  |

Never set `DEV` in production (it is refused for a non-loopback `BASE_URL`).

The container must be reachable **only through the tunnel**: rate limiting trusts
`CF-Connecting-IP`.

## Operations

- Daily sync: grep the logs for `daily sync done synced=X failed=Y` (18:00 UTC / 03:00 KST).
- Chat connections: `chat socket connected` / `chat subscription confirmed` per channel;
  `chat session ended` lines carry the reason and the retry delay.
- Back up the database off-host with the built-in snapshot (safe while serving; see below).

## Backup and restore

Never copy the live `/data/djclass.sqlite3` (or its `-wal`) — a copy taken mid-write
can be torn. Use the binary's snapshot, which reads only committed data on its own
read-only connection, checks `PRAGMA integrity_check`, and never blocks the server:

```sh
# stream a snapshot into restic (the homelab host does this on a timer)
podman exec chatoverlay-web /djclass backup - \
  | restic backup --stdin --stdin-filename chatoverlay.sqlite3 --tag chatoverlay
```

`/djclass backup /data/some-file.sqlite3` writes the snapshot to a file instead.

Restore: stop the container, `restic restore` the snapshot, replace
`/data/djclass.sqlite3` with it and delete any `djclass.sqlite3-wal` / `-shm` next to
it, then start the container (pending migrations apply on start). The snapshot is a
single self-contained file.

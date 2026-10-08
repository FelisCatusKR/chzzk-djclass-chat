# Deployment

Production runs as a **single container** on a self-hosted rootless Podman host. The
host's wiring (units, secrets, tunnel) lives in a separate private infra repo; this
file documents the **contract** the app expects from any deployer.

There is **no worker process** — the daily DJ CLASS sync runs in-process inside the
ASGI server (an asyncio scheduler task that fires at 18:00 UTC). Run **exactly one
instance**, or the sync fires more than once.

## How a change reaches production

GitOps pull: the host polls `main` (about every 2 minutes), builds the image from the
new commit, and restarts the container. CI does not deploy. What gates `main` is branch
protection — PRs must pass the `build` check before merging.

If a build or the post-restart health check fails, the host keeps (or rolls back to) the
previous image.

## Container contract

> A Go replacement image (`--target go-runner`) is built alongside but not deployed yet;
> its contract and the switch-over steps are in [`go/CUTOVER.md`](./go/CUTOVER.md).

| Item         | Value                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Build        | multi-stage [`Dockerfile`](./Dockerfile), target `runner`, no build args                                 |
| Command      | `sh -c "python manage.py migrate --noinput && exec python manage.py runasgi --host 0.0.0.0 --port 8000"` |
| Port         | `8000` (plain HTTP; TLS terminates at the Cloudflare Tunnel in front)                                    |
| Health       | `GET http://localhost:8000/` → `200`                                                                     |
| Static files | baked at build time (`collectstatic`), served by WhiteNoise                                              |
| State        | PostgreSQL only (via `DATABASE_URL`); the container filesystem is disposable                             |

Migrations run on every start, so a deploy that adds migrations needs no manual step.

> Podman builds images in OCI format, which **drops the Dockerfile `HEALTHCHECK`**.
> Deployers using Podman must declare the health check on the container themselves.

## Environment

See [`AGENTS.md`](./AGENTS.md) §9 for the full list. Production specifics:

- `DJANGO_SETTINGS_MODULE=config.settings.production`
- `BASE_URL=https://<public-domain>` — drives the OAuth redirect_uri, widget URLs, and
  the CSRF trusted origin.
- `DJANGO_ALLOWED_HOSTS=<public-domain>,localhost,127.0.0.1` — `localhost` lets the
  in-container health check pass.
- Secrets (`DJANGO_SECRET_KEY`, `VARCHIVE_TOKEN_KEY`, `CHZZK_CLIENT_SECRET`,
  `DATABASE_URL`) are injected by the host, never committed.

> Generate secrets with e.g. `head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32`.
> Changing `VARCHIVE_TOKEN_KEY` later invalidates every previously-encrypted Chzzk
> channel token in the DB, forcing streamers to re-authenticate — so set it once and
> carry it over on any host migration.

## Operations

Confirm the in-process daily sync fired (18:00 UTC / 03:00 KST) by grepping the
container logs for the scheduler line:

```
[scheduler] daily sync done: synced=X failed=Y
```

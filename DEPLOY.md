# Deployment (Dokku)

This service runs as a **single Dokku app with two process types** (`web` + `worker`,
see [`Procfile`](./Procfile)) that **share one SQLite database** on a mounted volume.
They must live in the same app — do not split them into two apps, or they would no
longer share `data/app.db`.

The image is built from the multi-stage [`Dockerfile`](./Dockerfile) (Node 24).
`NEXT_PUBLIC_BASE_URL` is consumed by Next.js at **build time**, so it is passed as a
Docker `--build-arg` (via `dokku docker-options`), not only as a runtime config var.

## Prerequisites

- A Dokku host with the `docker-options` and `storage` plugins (bundled with Dokku).
- TLS is terminated upstream (e.g. a Cloudflare tunnel → `http://localhost:80`), so
  Dokku serves plain HTTP on port 80 and routes by vhost. No Let's Encrypt needed.

## First-time setup

Run on the Dokku host (replace the secret values):

```bash
APP=chatoverlay
DOMAIN=chatoverlay.felis.kr
REPO=https://github.com/FelisCatusKR/chzzk-djclass-chat.git
BRANCH=main

# 1. App
dokku apps:create $APP

# 2. Persistent storage for SQLite (shared by web + worker)
dokku storage:ensure-directory $APP
dokku storage:mount $APP /var/lib/dokku/data/storage/$APP:/app/data

# 3. Runtime config + secrets
dokku config:set --no-restart $APP \
  NODE_ENV=production \
  CHZZK_CLIENT_ID=<your-prod-client-id> \
  CHZZK_CLIENT_SECRET=<your-prod-client-secret> \
  VARCHIVE_TOKEN_KEY=<32-char-random> \
  SESSION_SECRET=<32-char-random> \
  DATABASE_URL=./data/app.db \
  NEXT_PUBLIC_BASE_URL=https://$DOMAIN

# 4. Build-time arg (Next inlines NEXT_PUBLIC_* during `next build`)
dokku docker-options:add $APP build '--build-arg NEXT_PUBLIC_BASE_URL=https://chatoverlay.felis.kr'

# 5. Domain + proxy port (external 80 -> container 3000)
dokku domains:set $APP $DOMAIN
dokku ports:set $APP http:80:3000

# 6. Build & deploy from GitHub
dokku git:sync --build $APP $REPO $BRANCH

# 7. Scale to 1 web + 1 worker
dokku ps:scale $APP web=1 worker=1
```

> Generate secrets with e.g. `head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32`.
> Changing `VARCHIVE_TOKEN_KEY` later invalidates all previously-encrypted V-ARCHIVE/Chzzk
> tokens in the DB, forcing users to re-link — so set it once at first deploy.

## Redeploying after pushing new code

```bash
dokku git:sync --build chatoverlay https://github.com/FelisCatusKR/chzzk-djclass-chat.git main
```

## Operations

```bash
dokku logs chatoverlay -t          # tail logs (web + worker)
dokku ps:report chatoverlay        # process / scale status
dokku config:show chatoverlay      # current env (secrets visible — run privately)
dokku ps:restart chatoverlay       # restart all processes
```

# Deployment (Dokku)

This service runs as a **single Dokku app** (`chatoverlay-django`) with one `web`
process (see [`Procfile`](./Procfile)). There is **no worker process** — the daily
DJ CLASS sync runs in-process inside the ASGI server (an asyncio scheduler task that
fires at 18:00 UTC). Persistent data lives in a **Dokku-managed PostgreSQL** service
linked via `DATABASE_URL`.

The image is built from the multi-stage [`Dockerfile`](./Dockerfile) (Python 3.14 +
uv). It needs no build args — there is no client bundle to inline; `collectstatic`
runs at build time and WhiteNoise serves the hashed static files.

## Prerequisites

- A Dokku host with the `postgres` plugin (`dokku plugin:install https://github.com/dokku/dokku-postgres.git postgres`).
- TLS is terminated upstream (e.g. a Cloudflare Tunnel → `http://localhost:80`), so
  Dokku serves plain HTTP on port 80 and routes by vhost. No Let's Encrypt needed.

## First-time setup

Run on the Dokku host (replace the secret values):

```bash
APP=chatoverlay-django
DOMAIN=chatoverlay.felis.kr
REPO=https://github.com/FelisCatusKR/chzzk-djclass-chat.git
BRANCH=main

# 1. App
dokku apps:create $APP

# 2. PostgreSQL + link (exposes DATABASE_URL to the app)
dokku postgres:create ${APP}-db
dokku postgres:link ${APP}-db $APP

# 3. Runtime config + secrets
dokku config:set --no-restart $APP \
  DJANGO_SETTINGS_MODULE=config.settings.production \
  DJANGO_SECRET_KEY=<50+-char-random> \
  VARCHIVE_TOKEN_KEY=<32-char-random> \
  CHZZK_CLIENT_ID=<your-prod-client-id> \
  CHZZK_CLIENT_SECRET=<your-prod-client-secret> \
  BASE_URL=https://$DOMAIN \
  DJANGO_ALLOWED_HOSTS=$DOMAIN,localhost,127.0.0.1
  # DJANGO_CSRF_TRUSTED_ORIGINS defaults to BASE_URL; set it only for extra origins.

# 4. Domain + proxy port (external 80 -> container 8000)
dokku domains:set $APP $DOMAIN
dokku ports:set $APP http:80:8000

# 5. Build & deploy from GitHub (the Procfile `release` phase runs `migrate`)
dokku git:sync --build $APP $REPO $BRANCH

# 6. Scale to a single web process (the daily scheduler rides inside it)
dokku ps:scale $APP web=1
```

> Generate secrets with e.g. `head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32`.
> Changing `VARCHIVE_TOKEN_KEY` later invalidates every previously-encrypted Chzzk
> channel token in the DB, forcing streamers to re-authenticate — so set it once.
> `localhost,127.0.0.1` in `DJANGO_ALLOWED_HOSTS` lets the container HEALTHCHECK pass.

## Database migrations

Migrations run automatically on every deploy via the Procfile `release` phase
(`python manage.py migrate --noinput`) — no manual step.

## Redeploying after pushing new code

Manual:

```bash
dokku git:sync --build chatoverlay-django https://github.com/FelisCatusKR/chzzk-djclass-chat.git main
```

## Automatic deploy on push to `main`

The `deploy` job in [`ci.yml`](./.github/workflows/ci.yml) runs the same `git:sync`
automatically after CI passes. The Dokku host is behind NAT with **no inbound SSH
port**, so GitHub Actions reaches it _through the existing Cloudflare Tunnel_, gated by
a Cloudflare Access **service token** in front of the normal Dokku SSH key (two
independent auth layers; prod never runs a CI runner).

Flow: `push main → CI build passes → Actions opens SSH via cloudflared → Access service
token authorises the tunnel → Dokku SSH key authenticates → dokku git:sync --build`.

### One-time host + Cloudflare setup

1. **Expose SSH over the existing tunnel.** Add a public hostname to the tunnel
   (dashboard: Zero Trust → Networks → Tunnels → your tunnel → Public Hostname), or in
   the tunnel `config.yml` ingress:

   ```yaml
   ingress:
     - hostname: ssh.chatoverlay.felis.kr
       service: ssh://localhost:22
     # ... existing HTTP rule(s) ...
     - service: http_status:404
   ```

   DNS for `ssh.chatoverlay.felis.kr` is created automatically by the tunnel.

2. **Create a service token.** Zero Trust → Access → Service Auth → Service Tokens →
   _Create_. Set duration to non-expiring. Copy the **Client ID** and **Client Secret**
   (secret is shown only once).

3. **Protect the SSH hostname with Access.** Zero Trust → Access → Applications → add a
   _Self-hosted_ application for `ssh.chatoverlay.felis.kr`, with a policy whose action
   is **Service Auth** and whose Include is the service token from step 2. (Service Auth
   skips the interactive browser login, which is what lets CI authenticate headlessly.)

4. **Authorise the deploy key on Dokku.** Generate a dedicated keypair and register the
   public half with the `dokku` user:

   ```bash
   ssh-keygen -t ed25519 -f ci-deploy -N '' -C 'github-actions-deploy'
   dokku ssh-keys:add ci-deploy < ci-deploy.pub
   ```

### GitHub repository secrets

Settings → Secrets and variables → Actions:

| Secret                    | Value                                   |
| ------------------------- | --------------------------------------- |
| `DOKKU_SSH_HOST`          | `ssh.chatoverlay.felis.kr`              |
| `DOKKU_SSH_KEY`           | private key (`ci-deploy`) from step 4   |
| `CF_ACCESS_CLIENT_ID`     | service-token Client ID from step 2     |
| `CF_ACCESS_CLIENT_SECRET` | service-token Client Secret from step 2 |

After that, every push to `main` that passes CI redeploys automatically. The first run
records the host key via `StrictHostKeyChecking=accept-new`; for stricter hygiene, pin
it instead by committing a known_hosts entry.

## Operations

```bash
dokku logs chatoverlay-django -t           # tail logs (web; includes the scheduler)
dokku ps:report chatoverlay-django         # process / scale status
dokku config:show chatoverlay-django       # current env (secrets visible — run privately)
dokku ps:restart chatoverlay-django        # restart
dokku postgres:info chatoverlay-django-db  # database status

# Confirm the in-process daily sync fired (18:00 UTC / 03:00 KST):
dokku logs chatoverlay-django | grep -i scheduler
# → [scheduler] daily sync done: synced=X failed=Y
```

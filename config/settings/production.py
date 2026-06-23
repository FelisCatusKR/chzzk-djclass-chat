from .base import *  # noqa: F403
from .base import env

DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

# Secrets required in production (fail fast if unset).
CHZZK_CLIENT_ID = env("CHZZK_CLIENT_ID")
CHZZK_CLIENT_SECRET = env("CHZZK_CLIENT_SECRET")

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# TLS terminates at the Cloudflare Tunnel; trust its forwarded scheme so
# request.is_secure() is true (secure cookies, HSTS).
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31536000  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
# (No SECURE_HSTS_PRELOAD — that's a separate, hard-to-undo commitment.)

# CSRF hardening. CSRF_TRUSTED_ORIGINS makes same-origin HTTPS POSTs pass the
# Origin check behind the proxy; defaults to BASE_URL.
CSRF_COOKIE_HTTPONLY = True  # token is delivered via {{ csrf_token }}, never JS-read
# BASE_URL is required in production (it drives the OAuth redirect_uri, widget URLs,
# and the CSRF trusted origin) — fail fast rather than silently inheriting base.py's
# http://localhost default, which would 403 every HTTPS POST.
BASE_URL = env("BASE_URL")
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[BASE_URL])

# We deliberately do NOT set SECURE_SSL_REDIRECT: Cloudflare serves HTTPS-only at
# the edge, and an in-app redirect risks loops on the OAuth/SSE paths. Silence the
# deploy-check warning for it.
SILENCED_SYSTEM_CHECKS = [
    "security.W008",  # no SECURE_SSL_REDIRECT — Cloudflare handles HTTPS at edge
    "security.W021",  # no SECURE_HSTS_PRELOAD — preload is a hard-to-undo commitment
]

# Hashed + compressed static for cache-busting; served by WhiteNoise.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
    },
}
# In prod, collectstatic + the manifest serve static; finders are a dev-only
# convenience (base.py enables them) and add startup overhead here.
WHITENOISE_USE_FINDERS = False

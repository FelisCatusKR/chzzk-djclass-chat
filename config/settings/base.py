from pathlib import Path

import environ
from django.utils.csp import CSP

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env.django")

SECRET_KEY = env("DJANGO_SECRET_KEY")
VARCHIVE_TOKEN_KEY = env("VARCHIVE_TOKEN_KEY")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "djclass_overlay.common",
    "djclass_overlay.users",
    "djclass_overlay.streamers",
    "djclass_overlay.viewers",
    "djclass_overlay.djclass",
    "djclass_overlay.overlay",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "djclass_overlay.common.middleware.SecurityHeadersMiddleware",
]

# --- Security headers (env-agnostic) ---
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"

# Static allowlist: Alpine needs 'unsafe-eval' (script), @tailwindcss/browser
# injects <style> at runtime needing 'unsafe-inline' (style) — so no nonces.
# Shipped report-only; a later task flips it to enforcing (SECURE_CSP) after a
# clean browser check. The CDN-free OBS overlay only uses 'self', unaffected.
_CSP_POLICY = {
    "default-src": [CSP.SELF],
    "script-src": [CSP.SELF, CSP.UNSAFE_EVAL, "https://cdn.jsdelivr.net"],
    "style-src": [CSP.SELF, CSP.UNSAFE_INLINE, "https://cdn.jsdelivr.net"],
    "img-src": [CSP.SELF, "https://chzzk-djclass-assets.pages.dev", "data:"],
    "font-src": ["https://cdn.jsdelivr.net"],
    "connect-src": [CSP.SELF],
}
SECURE_CSP_REPORT_ONLY = _CSP_POLICY

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "djclass_overlay" / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    },
]

DATABASES = {"default": env.db("DATABASE_URL")}

AUTH_USER_MODEL = "users.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
WHITENOISE_USE_FINDERS = True  # serve app/static files directly (no collectstatic needed in dev)
STATICFILES_DIRS = [BASE_DIR / "djclass_overlay" / "static"]

# --- Chzzk OAuth ---
# Secrets: not required for build/tests (Chzzk HTTP is mocked). Empty default keeps
# dev/test runs working; production.py re-reads CLIENT_ID/SECRET as required.
CHZZK_CLIENT_ID = env("CHZZK_CLIENT_ID", default="")
CHZZK_CLIENT_SECRET = env("CHZZK_CLIENT_SECRET", default="")
# Public origin used to build redirect_uri + the OAuth callback. No trailing slash.
BASE_URL = env("BASE_URL", default="http://localhost:8000")

# --- Auth / sessions ---
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/dashboard/"
LOGOUT_REDIRECT_URL = "/"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 7 days, matching the legacy session cookie
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True

AUTHENTICATION_BACKENDS = [
    "djclass_overlay.users.backends.ChzzkBackend",
    "django.contrib.auth.backends.ModelBackend",  # /admin superuser login
]

# --- Logging (realtime is otherwise silent) ---
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {
        "djclass_overlay": {"handlers": ["console"], "level": "INFO"},
    },
}

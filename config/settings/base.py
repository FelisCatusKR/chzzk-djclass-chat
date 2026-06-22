from pathlib import Path

import environ

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
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

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

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

# Secrets required in production (fail fast if unset).
CHZZK_CLIENT_ID = env("CHZZK_CLIENT_ID")
CHZZK_CLIENT_SECRET = env("CHZZK_CLIENT_SECRET")

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

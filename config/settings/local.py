from .base import *  # noqa: F401,F403
from .base import env

DEBUG = True
# Defaults cover a plain local run; add tunnel/other hosts via DJANGO_ALLOWED_HOSTS
# in .env.django (e.g. the dev Cloudflare Tunnel domain) — keeps dev hosts out of git.
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

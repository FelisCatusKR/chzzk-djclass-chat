# Build stage — install deps + project into /app/.venv via uv
FROM python:3.13-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY . .
RUN uv sync --frozen --no-dev

# Runtime stage
FROM python:3.13-slim-bookworm AS runner
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=config.settings.production \
    PYTHONUNBUFFERED=1
COPY --from=builder /app /app

# Bake collected static into the image (build-time dummies — collectstatic needs
# settings to import but touches no DB or real secret).
RUN DJANGO_SECRET_KEY=build-only-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
    VARCHIVE_TOKEN_KEY=build-only-key-32-characters-okay \
    CHZZK_CLIENT_ID=build CHZZK_CLIENT_SECRET=build \
    DATABASE_URL=sqlite:////tmp/build.db DJANGO_ALLOWED_HOSTS=localhost BASE_URL=https://build.local \
    python manage.py collectstatic --noinput

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/').status==200 else 1)"

# Default command; Dokku overrides it with the Procfile `web` process.
CMD ["python", "manage.py", "runasgi", "--host", "0.0.0.0", "--port", "8000"]

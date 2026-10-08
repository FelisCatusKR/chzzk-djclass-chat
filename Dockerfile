# ---------------------------------------------------------------------------
# Go server (cutover target; see go/CUTOVER.md). Production still builds
# `--target runner` (Django, below) until the cutover switches the target.
# ---------------------------------------------------------------------------
FROM golang:1.27.1-trixie AS go-builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
# Widget/page assets still live in the Django tree; bake them into the binary.
COPY djclass_overlay/static/css/chat.css internal/web/static/css/
COPY djclass_overlay/static/js/components.js internal/web/static/js/
COPY djclass_overlay/overlay/static/overlay/widget.js internal/web/static/overlay/
# modernc.org/sqlite is pure Go: a static binary, no cgo.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/djclass ./cmd/server \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian13:nonroot AS go-runner
COPY --from=go-builder /out/djclass /djclass
# /data holds the SQLite file (+ -wal/-shm): mount a persistent volume here.
COPY --from=go-builder --chown=65532:65532 /out/data /data
ENV SQLITE_PATH=/data/djclass.sqlite3 ADDR=:8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/djclass", "healthcheck"]
ENTRYPOINT ["/djclass"]
CMD ["serve"]

# ---------------------------------------------------------------------------
# Django app (current production target)
# ---------------------------------------------------------------------------
# Build stage — install deps + project into /app/.venv via uv
FROM python:3.14-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY . .
RUN uv sync --frozen --no-dev

# Runtime stage
FROM python:3.14-slim-bookworm AS runner
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

# Default command. Run `python manage.py migrate --noinput` before it on each deploy
# (the production deployer chains both; see DEPLOY.md).
CMD ["python", "manage.py", "runasgi", "--host", "0.0.0.0", "--port", "8000"]

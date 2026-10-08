# DJ CLASS overlay server: static Go binary on distroless (Debian 13).
# CI publishes `--target go-runner` to GHCR; see DEPLOY.md.
FROM golang:1.27.1-trixie AS go-builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
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

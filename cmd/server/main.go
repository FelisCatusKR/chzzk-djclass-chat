// Command server is the DJ CLASS overlay service binary.
//
//	server [-env FILE] [serve]        HTTP (pages, widget, SSE) + chat workers + daily sync
//	server healthcheck                exit 0 if GET /healthz on ADDR answers 200 (container probe)
//	server backup FILE|-              consistent snapshot of SQLITE_PATH while serving; "-" streams it
//	                                  to stdout (e.g. | restic backup --stdin)
//
// Local dev: go run ./cmd/server   (reads .env if present)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/alexedwards/scs/v2"

	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/chzzk"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/config"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/crypto"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/link"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/ratelimit"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/realtime"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/resolver"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/schedule"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/store"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/varchive"
	"github.com/FelisCatusKR/chzzk-djclass-chat/internal/web"
)

func main() {
	envFile := flag.String("env", ".env", "dotenv file (optional; real env vars win)")
	flag.Parse()
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cmd, args := "serve", flag.Args()
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch {
	case cmd == "healthcheck" && len(args) == 0:
		err = healthcheck()
	case cmd == "backup" && len(args) == 1:
		err = backup(args[0], log)
	case cmd == "serve" && len(args) == 0:
		err = withConfig(*envFile, func(cfg config.Config) error { return serve(cfg, log) })
	default:
		err = fmt.Errorf("usage: server [-env FILE] [serve | healthcheck | backup FILE|-]")
	}
	if err != nil {
		log.Error(cmd+" failed", "err", err)
		os.Exit(1)
	}
}

func withConfig(envFile string, f func(config.Config) error) error {
	if err := config.LoadDotenv(envFile); err != nil {
		return err
	}
	cfg, err := config.FromEnv()
	if err != nil {
		return err
	}
	return f(cfg)
}

// healthcheck needs no secrets: it only probes the running server.
func healthcheck() error {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8000"
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	c := &http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthz: HTTP %d", resp.StatusCode)
	}
	return nil
}

// backup needs no secrets: only the database path. Logs go to stderr, so
// stdout carries nothing but the snapshot in "-" mode.
func backup(target string, log *slog.Logger) error {
	src := os.Getenv("SQLITE_PATH")
	if src == "" {
		src = "djclass.sqlite3"
	}
	ctx := context.Background()
	if target != "-" {
		if err := store.Snapshot(ctx, src, target); err != nil {
			return err
		}
		log.Info("backup written", "file", target)
		return nil
	}

	dir, err := os.MkdirTemp("", "djclass-backup-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	tmp := filepath.Join(dir, "snapshot.sqlite3")
	if err := store.Snapshot(ctx, src, tmp); err != nil {
		return err
	}
	f, err := os.Open(tmp)
	if err != nil {
		return err
	}
	defer f.Close()
	n, err := io.Copy(os.Stdout, f)
	if err != nil {
		return err
	}
	log.Info("backup streamed", "bytes", n)
	return nil
}

func serve(cfg config.Config, log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.SQLitePath)
	if err != nil {
		return err
	}
	defer st.Close()
	box, err := crypto.New(cfg.TokenKey)
	if err != nil {
		return err
	}
	cz := chzzk.New(cfg.ChzzkClientID, cfg.ChzzkClientSecret, cfg.BaseURL+"/api/auth/chzzk/callback")

	if cfg.Dev {
		if err := web.SeedDev(ctx, st); err != nil {
			return err
		}
		log.Warn("DEV mode: demo viewers seeded, /dev enabled — never run this in production")
	}

	badges := resolver.New(st.Read)
	hub := realtime.New(realtime.Config{
		Tokens:   &realtime.Tokens{Store: st, Box: box, Chzzk: cz},
		API:      cz,
		Resolver: badges,
		Logger:   log,
	})
	links := &link.Service{Store: st, VA: varchive.New(), Cache: badges, Log: log}
	// Daily DJ CLASS sync at 18:00 UTC (03:00 KST), in-process.
	go schedule.Daily(ctx, 18, func(ctx context.Context) {
		ok, failed := links.SyncAll(ctx)
		log.Info("daily sync done", "synced", ok, "failed", failed)
	})
	sessions := scs.New()
	sessions.Store = st.Sessions()
	sessions.Lifetime = 7 * 24 * time.Hour // same as the Django session cookie
	sessions.Cookie.Name = "session"
	sessions.Cookie.HttpOnly = true
	sessions.Cookie.SameSite = http.SameSiteLaxMode
	sessions.Cookie.Secure = cfg.HTTPS
	go st.Sessions().Cleanup(ctx, time.Hour)

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: (&web.Server{
			Hub: hub, Store: st, Chzzk: cz, Box: box, Sessions: sessions, Limiter: ratelimit.New(nil), Link: links,
			BaseURL: cfg.BaseURL, HTTPS: cfg.HTTPS, Log: log, Dev: cfg.Dev, Static: web.StaticAssets(),
		}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second, // bounds slow request bodies; SSE is unaffected (tested)
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("listening", "addr", cfg.Addr, "base_url", cfg.BaseURL, "db", cfg.SQLitePath)

	select {
	case err := <-errc:
		hub.Close()
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	hub.Close() // ends SSE streams first; Shutdown would otherwise wait on them forever
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

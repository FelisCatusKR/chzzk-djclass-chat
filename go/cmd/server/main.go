// Command server runs the DJ CLASS overlay service: HTTP (widget page, SSE,
// login) plus the in-process Chzzk chat workers, in one process.
//
//	cd go && go run ./cmd/server          # reads .env if present
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
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
	if err := run(*envFile, log); err != nil {
		log.Error("server failed", "err", err)
		os.Exit(1)
	}
}

func run(envFile string, log *slog.Logger) error {
	if err := config.LoadDotenv(envFile); err != nil {
		return err
	}
	cfg, err := config.FromEnv()
	if err != nil {
		return err
	}
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
			BaseURL: cfg.BaseURL, HTTPS: cfg.HTTPS, Log: log, Dev: cfg.Dev, Static: web.DjangoStatic(cfg.DjangoDir),
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

// Package config reads the server configuration from the environment
// (optionally seeded from a dotenv file). Names match the Django app's
// .env.django where they overlap; DATABASE_URL is replaced by SQLITE_PATH.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr              string // ADDR, default ":8000"
	BaseURL           string // BASE_URL, public origin without trailing slash
	SQLitePath        string // SQLITE_PATH
	ChzzkClientID     string // CHZZK_CLIENT_ID
	ChzzkClientSecret string // CHZZK_CLIENT_SECRET
	TokenKey          string // VARCHIVE_TOKEN_KEY (encrypts Chzzk tokens at rest)
	DjangoDir         string // DJANGO_DIR: repo root; widget assets are served from the Django tree until cutover
	Dev               bool   // DEV=1: seed demo viewers, enable /dev. Only for a localhost BASE_URL.
	HTTPS             bool   // BASE_URL scheme is https: Secure cookies + HSTS
}

func FromEnv() (Config, error) {
	c := Config{
		Addr:              envOr("ADDR", ":8000"),
		BaseURL:           strings.TrimRight(envOr("BASE_URL", "http://localhost:8000"), "/"),
		SQLitePath:        envOr("SQLITE_PATH", "djclass.sqlite3"),
		ChzzkClientID:     os.Getenv("CHZZK_CLIENT_ID"),
		ChzzkClientSecret: os.Getenv("CHZZK_CLIENT_SECRET"),
		TokenKey:          os.Getenv("VARCHIVE_TOKEN_KEY"),
		DjangoDir:         envOr("DJANGO_DIR", "."),
	}
	if v := os.Getenv("DEV"); v != "" {
		dev, err := strconv.ParseBool(v)
		if err != nil {
			return c, fmt.Errorf("config: DEV: %w", err)
		}
		c.Dev = dev
	}
	var missing []string
	for name, v := range map[string]string{
		"CHZZK_CLIENT_ID": c.ChzzkClientID, "CHZZK_CLIENT_SECRET": c.ChzzkClientSecret, "VARCHIVE_TOKEN_KEY": c.TokenKey,
	} {
		if v == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return c, fmt.Errorf("config: missing %s", strings.Join(missing, ", "))
	}
	u, err := url.Parse(c.BaseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return c, fmt.Errorf("config: BASE_URL must be an absolute http(s) URL, got %q", c.BaseURL)
	}
	c.HTTPS = u.Scheme == "https" // url.Parse lower-cases the scheme
	if c.Dev && !isLoopback(u.Hostname()) {
		return c, errors.New("config: DEV mode is only allowed with a localhost BASE_URL")
	}
	return c, nil
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// LoadDotenv sets KEY=VALUE lines from path without overriding variables that
// are already set. A missing file is not an error.
func LoadDotenv(path string) error {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		if _, set := os.LookupEnv(k); !set {
			if err := os.Setenv(k, v); err != nil {
				return err
			}
		}
	}
	return sc.Err()
}

package config

import (
	"strings"
	"testing"
)

func TestFromEnvBaseURLAndDev(t *testing.T) {
	cases := []struct {
		base, dev string
		https     bool
		errPart   string
	}{
		{"http://localhost:8000", "1", false, ""},
		{"http://127.0.0.1:8000", "1", false, ""},
		{"https://overlay.example", "", true, ""},
		{"HTTPS://overlay.example", "", true, ""},           // scheme is case-insensitive
		{"HTTPS://overlay.example", "1", true, "localhost"}, // the old prefix check missed this
		{"http://overlay.example", "1", false, "localhost"}, // http prod is still not dev
		{"overlay.example", "", false, "absolute"},
		{"ftp://overlay.example", "", false, "absolute"},
	}
	for _, c := range cases {
		t.Setenv("CHZZK_CLIENT_ID", "id")
		t.Setenv("CHZZK_CLIENT_SECRET", "secret")
		t.Setenv("VARCHIVE_TOKEN_KEY", "key")
		t.Setenv("BASE_URL", c.base)
		t.Setenv("DEV", c.dev)
		cfg, err := FromEnv()
		switch {
		case c.errPart == "" && err != nil:
			t.Errorf("%s DEV=%s: %v", c.base, c.dev, err)
		case c.errPart != "" && (err == nil || !strings.Contains(err.Error(), c.errPart)):
			t.Errorf("%s DEV=%s: err = %v, want %q", c.base, c.dev, err, c.errPart)
		case err == nil && cfg.HTTPS != c.https:
			t.Errorf("%s: HTTPS = %v", c.base, cfg.HTTPS)
		}
	}
}

func TestFromEnvRequiresSecrets(t *testing.T) {
	t.Setenv("CHZZK_CLIENT_ID", "")
	t.Setenv("CHZZK_CLIENT_SECRET", "s")
	t.Setenv("VARCHIVE_TOKEN_KEY", "")
	if _, err := FromEnv(); err == nil || !strings.Contains(err.Error(), "CHZZK_CLIENT_ID") || !strings.Contains(err.Error(), "VARCHIVE_TOKEN_KEY") {
		t.Errorf("err = %v", err)
	}
}

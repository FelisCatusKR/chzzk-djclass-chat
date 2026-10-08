package crypto

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

const testSecret = "test-key-not-a-secret-0123456789"

// Produced by djclass_overlay/common/crypto.py's scheme (cryptography AESGCM)
// with fixed nonces, so Go must decrypt exactly what Django stored.
var pythonVectors = []struct{ plaintext, value string }{
	{"hello-token", "AAECAwQFBgcICQoLf+6DD/r9u6md/fQHvAwaNnNbc26UI7f4cDbm"},
	{"한글 토큰 🎧", "/+7dzLuqmYh3ZlVEBecEoemNnZ6zDBpjeHbXdfxe/R7czVYYmf89kDISlqZwvg=="},
	{"", "CgoKCgoKCgoKCgoKjWtcx3f//UN8fKNR8PBrog=="},
}

func newBox(t *testing.T, secret string) *Box {
	t.Helper()
	b, err := New(secret)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestDecryptsPythonValues(t *testing.T) {
	b := newBox(t, testSecret)
	for _, v := range pythonVectors {
		got, err := b.Decrypt(v.value)
		if err != nil {
			t.Fatalf("Decrypt(%q): %v", v.value, err)
		}
		if got != v.plaintext {
			t.Errorf("Decrypt(%q) = %q, want %q", v.value, got, v.plaintext)
		}
	}
}

func TestEncryptFormatAndRoundTrip(t *testing.T) {
	b := newBox(t, testSecret)
	for _, pt := range []string{"hello-token", "한글 토큰 🎧", ""} {
		v := b.Encrypt(pt)
		raw, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			t.Fatalf("not std base64: %v", err)
		}
		if want := nonceSize + len(pt) + 16; len(raw) != want {
			t.Errorf("len = %d, want nonce+ct+tag = %d", len(raw), want)
		}
		if got, err := b.Decrypt(v); err != nil || got != pt {
			t.Errorf("round trip %q = %q, %v", pt, got, err)
		}
	}
	if b.Encrypt("x") == b.Encrypt("x") {
		t.Error("same plaintext produced the same value (nonce reuse)")
	}
}

func TestDecryptRejects(t *testing.T) {
	b := newBox(t, testSecret)
	good := pythonVectors[0].value
	raw, _ := base64.StdEncoding.DecodeString(good)
	raw[len(raw)-1] ^= 1
	cases := map[string]string{
		"tampered":  base64.StdEncoding.EncodeToString(raw),
		"too short": base64.StdEncoding.EncodeToString(make([]byte, 27)),
		"not b64":   "%%%",
		"urlsafe":   strings.NewReplacer("+", "-", "/", "_").Replace(pythonVectors[1].value),
	}
	for name, v := range cases {
		if _, err := b.Decrypt(v); !errors.Is(err, ErrDecrypt) {
			t.Errorf("%s: err = %v, want ErrDecrypt", name, err)
		}
	}
	if _, err := newBox(t, "other-key").Decrypt(good); !errors.Is(err, ErrDecrypt) {
		t.Errorf("wrong key: err = %v", err)
	}
	if _, err := New(""); err == nil {
		t.Error("empty key accepted")
	}
}

// Package crypto encrypts Chzzk channel tokens at rest. The format is the one
// the former Django app used (its rows were imported as-is at the 2026-10
// cutover), so it must not change without re-encrypting stored tokens:
//
//	key   = SHA-256(VARCHIVE_TOKEN_KEY)            (any length in, 32 bytes out)
//	value = base64std(nonce[12] || AES-256-GCM(plaintext) || tag[16])
//
// A fresh random nonce per value, no associated data.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

const nonceSize = 12

var ErrDecrypt = errors.New("crypto: cannot decrypt value (wrong key or corrupted data)")

type Box struct {
	aead cipher.AEAD
}

// New derives the AES-256 key from secret the same way the Python code does.
func New(secret string) (*Box, error) {
	if secret == "" {
		return nil, errors.New("crypto: empty key")
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block) // 12-byte nonce, 16-byte tag
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

func (b *Box) Encrypt(plaintext string) string {
	nonce := make([]byte, nonceSize, nonceSize+len(plaintext)+b.aead.Overhead())
	_, _ = rand.Read(nonce) // never fails (crypto/rand panics on failure)
	return base64.StdEncoding.EncodeToString(b.aead.Seal(nonce, nonce, []byte(plaintext), nil))
}

// Decrypt never includes the value in its error.
func (b *Box) Decrypt(value string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(raw) < nonceSize+b.aead.Overhead() {
		return "", ErrDecrypt
	}
	pt, err := b.aead.Open(nil, raw[:nonceSize], raw[nonceSize:], nil)
	if err != nil {
		return "", ErrDecrypt
	}
	return string(pt), nil
}

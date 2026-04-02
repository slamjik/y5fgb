package security

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

func GenerateOpaqueToken(prefix string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("failed to generate token: %w", err)
	}

	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func HashToken(token, pepper string) string {
	hasher := sha256.New()
	hasher.Write([]byte(pepper))
	hasher.Write([]byte(token))
	return hex.EncodeToString(hasher.Sum(nil))
}

func ConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

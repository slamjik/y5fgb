package security

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

func FingerprintFromMaterial(material string) (fingerprint string, safetyNumber string) {
	sum := sha256.Sum256([]byte(strings.TrimSpace(material)))
	hexFingerprint := hex.EncodeToString(sum[:])

	digits := make([]byte, 0, 60)
	for _, ch := range hexFingerprint {
		if ch >= '0' && ch <= '9' {
			digits = append(digits, byte(ch))
		}
	}

	safety := string(digits)
	if len(safety) < 60 {
		safety = safety + strings.Repeat("0", 60-len(safety))
	}
	safety = safety[:60]
	safety = strings.Join([]string{safety[:12], safety[12:24], safety[24:36], safety[36:48], safety[48:60]}, "-")
	return hexFingerprint, safety
}

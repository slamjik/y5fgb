package validation

import (
	"errors"
	"regexp"
	"strings"
)

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
var mimePattern = regexp.MustCompile(`^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$`)
var allowedMimeTypes = map[string]struct{}{
	"application/octet-stream": {},
	"application/pdf":          {},
	"application/zip":          {},
	"text/plain":               {},
	"image/png":                {},
	"image/jpeg":               {},
	"image/jpg":                {},
	"image/webp":               {},
	"image/gif":                {},
	"image/avif":               {},
	"image/heic":               {},
	"image/heif":               {},
	"image/heic-sequence":      {},
	"image/heif-sequence":      {},
}

var mimeAliases = map[string]string{
	"image/jpg": "image/jpeg",
}

func Email(value string) error {
	v := strings.TrimSpace(strings.ToLower(value))
	if v == "" {
		return errors.New("email is required")
	}
	if !emailPattern.MatchString(v) {
		return errors.New("email format is invalid")
	}

	return nil
}

func Password(value string) error {
	if len(value) < 10 {
		return errors.New("password must be at least 10 characters")
	}
	if len(value) > 200 {
		return errors.New("password is too long")
	}

	return nil
}

func DeviceName(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return errors.New("device name is required")
	}
	if len(trimmed) > 128 {
		return errors.New("device name is too long")
	}

	return nil
}

func DeviceMaterial(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return errors.New("public device material is required")
	}
	if len(trimmed) > 4096 {
		return errors.New("public device material is too large")
	}

	return nil
}

func FileName(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return errors.New("file name is required")
	}
	if len(trimmed) > 255 {
		return errors.New("file name is too long")
	}
	if strings.Contains(trimmed, "..") || strings.Contains(trimmed, "/") || strings.Contains(trimmed, "\\") {
		return errors.New("file name contains invalid path characters")
	}
	if strings.ContainsAny(trimmed, "<>:\"|?*") {
		return errors.New("file name contains unsupported characters")
	}
	for _, symbol := range trimmed {
		if symbol == 0 {
			return errors.New("file name contains invalid null byte")
		}
		if symbol < 32 || symbol == 127 {
			return errors.New("file name contains control characters")
		}
	}

	return nil
}

func NormalizeMimeType(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if trimmed == "" {
		return ""
	}
	withoutParams := strings.TrimSpace(strings.Split(trimmed, ";")[0])
	if withoutParams == "" {
		return ""
	}
	if alias, ok := mimeAliases[withoutParams]; ok {
		return alias
	}
	return withoutParams
}

func MimeType(value string) error {
	trimmed := NormalizeMimeType(value)
	if trimmed == "" {
		return errors.New("mime type is required")
	}
	if len(trimmed) > 200 {
		return errors.New("mime type is too long")
	}
	if !mimePattern.MatchString(trimmed) {
		return errors.New("mime type format is invalid")
	}
	if _, ok := allowedMimeTypes[trimmed]; !ok {
		return errors.New("mime type is not allowed")
	}

	return nil
}

func ContainsUnsafeControlChars(value string, allowMultiline bool) bool {
	for _, symbol := range value {
		if symbol == 0 {
			return true
		}
		if symbol == '\r' || symbol == '\n' {
			if allowMultiline {
				continue
			}
			return true
		}
		if symbol == '\t' {
			continue
		}
		if (symbol >= 0 && symbol < 32) || symbol == 127 {
			return true
		}
	}
	return false
}

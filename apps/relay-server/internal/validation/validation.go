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

	return nil
}

func MimeType(value string) error {
	trimmed := strings.ToLower(strings.TrimSpace(value))
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

package media

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type localStorage struct {
	rootDir string
}

func newLocalStorage(rootDir string) (*localStorage, error) {
	trimmed := strings.TrimSpace(rootDir)
	if trimmed == "" {
		return nil, fmt.Errorf("media local storage root directory is required")
	}
	absRoot, err := filepath.Abs(trimmed)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve media local storage root: %w", err)
	}
	if mkErr := os.MkdirAll(absRoot, 0o755); mkErr != nil {
		return nil, fmt.Errorf("failed to prepare media local storage root: %w", mkErr)
	}
	return &localStorage{rootDir: absRoot}, nil
}

func (s *localStorage) Put(_ context.Context, objectKey string, payload []byte, _ string) error {
	path, err := s.resolveSafePath(objectKey)
	if err != nil {
		return err
	}
	if mkErr := os.MkdirAll(filepath.Dir(path), 0o755); mkErr != nil {
		return fmt.Errorf("failed to create media storage dir: %w", mkErr)
	}
	if writeErr := os.WriteFile(path, payload, 0o644); writeErr != nil {
		return fmt.Errorf("failed to write media object: %w", writeErr)
	}
	return nil
}

func (s *localStorage) Open(_ context.Context, objectKey string) (io.ReadCloser, error) {
	path, err := s.resolveSafePath(objectKey)
	if err != nil {
		return nil, err
	}
	file, openErr := os.Open(path)
	if openErr != nil {
		return nil, fmt.Errorf("failed to open media object: %w", openErr)
	}
	return file, nil
}

func (s *localStorage) Delete(_ context.Context, objectKey string) error {
	path, err := s.resolveSafePath(objectKey)
	if err != nil {
		return err
	}
	removeErr := os.Remove(path)
	if removeErr != nil && !os.IsNotExist(removeErr) {
		return fmt.Errorf("failed to delete media object: %w", removeErr)
	}
	return nil
}

func (s *localStorage) resolveSafePath(objectKey string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(objectKey, "\\", "/"))
	if normalized == "" {
		return "", fmt.Errorf("object key is required")
	}
	if strings.Contains(normalized, "..") {
		return "", fmt.Errorf("invalid object key")
	}

	cleaned := filepath.Clean(normalized)
	target := filepath.Join(s.rootDir, cleaned)
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", fmt.Errorf("failed to resolve media object path: %w", err)
	}

	root := s.rootDir
	if !strings.HasSuffix(root, string(filepath.Separator)) {
		root += string(filepath.Separator)
	}
	if absTarget != s.rootDir && !strings.HasPrefix(absTarget, root) {
		return "", fmt.Errorf("resolved media object path escapes root")
	}
	return absTarget, nil
}

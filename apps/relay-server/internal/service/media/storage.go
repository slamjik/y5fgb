package media

import (
	"context"
	"io"
)

type Storage interface {
	Put(ctx context.Context, objectKey string, payload []byte, mimeType string) error
	Open(ctx context.Context, objectKey string) (io.ReadCloser, error)
	Delete(ctx context.Context, objectKey string) error
}

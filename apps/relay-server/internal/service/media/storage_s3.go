package media

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type s3Storage struct {
	client *minio.Client
	bucket string
}

func newS3Storage(endpoint string, region string, bucket string, accessKey string, secretKey string) (*s3Storage, error) {
	normalizedEndpoint := strings.TrimSpace(endpoint)
	if normalizedEndpoint == "" {
		return nil, fmt.Errorf("s3 endpoint is required")
	}
	normalizedBucket := strings.TrimSpace(bucket)
	if normalizedBucket == "" {
		return nil, fmt.Errorf("s3 bucket is required")
	}
	parsedEndpoint, secure, err := parseS3Endpoint(normalizedEndpoint)
	if err != nil {
		return nil, err
	}

	client, err := minio.New(parsedEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
		Region: strings.TrimSpace(region),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize s3 client: %w", err)
	}
	return &s3Storage{
		client: client,
		bucket: normalizedBucket,
	}, nil
}

func (s *s3Storage) Put(ctx context.Context, objectKey string, payload []byte, mimeType string) error {
	reader := bytes.NewReader(payload)
	_, err := s.client.PutObject(ctx, s.bucket, objectKey, reader, int64(len(payload)), minio.PutObjectOptions{
		ContentType: mimeType,
	})
	if err != nil {
		return fmt.Errorf("failed to upload media object to s3: %w", err)
	}
	return nil
}

func (s *s3Storage) Open(ctx context.Context, objectKey string) (io.ReadCloser, error) {
	object, err := s.client.GetObject(ctx, s.bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to open media object from s3: %w", err)
	}
	if _, statErr := object.Stat(); statErr != nil {
		_ = object.Close()
		return nil, fmt.Errorf("failed to stat media object from s3: %w", statErr)
	}
	return object, nil
}

func (s *s3Storage) Delete(ctx context.Context, objectKey string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, objectKey, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("failed to delete media object from s3: %w", err)
	}
	return nil
}

func parseS3Endpoint(value string) (string, bool, error) {
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		parsed, err := url.Parse(value)
		if err != nil {
			return "", false, fmt.Errorf("invalid s3 endpoint: %w", err)
		}
		return parsed.Host, parsed.Scheme == "https", nil
	}
	return value, true, nil
}

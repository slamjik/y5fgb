package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/privacy"
	"github.com/example/secure-messenger/apps/relay-server/internal/validation"
)

type Service struct {
	cfg     config.MediaConfig
	repo    *postgres.Store
	storage Storage
	privacy *privacy.Service
}

type UploadInput struct {
	Principal  auth.AuthPrincipal
	Domain     domain.MediaDomain
	Kind       domain.MediaKind
	Visibility domain.VisibilityScope
	FileName   string
	MimeType   string
	Payload    []byte
}

type DownloadResult struct {
	Media   domain.MediaObject
	Content []byte
}

func New(cfg config.MediaConfig, repo *postgres.Store, privacyPolicy *privacy.Service) (*Service, error) {
	var (
		driver Storage
		err    error
	)
	if strings.EqualFold(cfg.StorageBackend, "s3") {
		driver, err = newS3Storage(cfg.S3Endpoint, cfg.S3Region, cfg.S3Bucket, cfg.S3AccessKey, cfg.S3SecretKey)
	} else {
		driver, err = newLocalStorage(cfg.LocalDir)
	}
	if err != nil {
		return nil, err
	}
	return &Service{
		cfg:     cfg,
		repo:    repo,
		storage: driver,
		privacy: privacyPolicy,
	}, nil
}

func (s *Service) Upload(ctx context.Context, input UploadInput) (domain.MediaObject, error) {
	if len(input.Payload) == 0 {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "empty file payload")
	}
	if err := validation.FileName(input.FileName); err != nil {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "invalid file name")
	}
	if !isValidDomain(input.Domain) {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "invalid media domain")
	}
	if !isValidKind(input.Kind) {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "invalid media kind")
	}
	if !isValidVisibility(input.Visibility) {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "invalid media visibility")
	}

	sizeLimit := s.resolveSizeLimit(input.Kind)
	if int64(len(input.Payload)) > sizeLimit {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "file exceeds allowed size")
	}

	sniffedMime := detectMimeType(input.Payload)
	if !isAllowedMimeForKind(input.Kind, sniffedMime) {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "file mime type is not allowed for this media kind")
	}

	normalizedMime := strings.ToLower(strings.TrimSpace(input.MimeType))
	if normalizedMime == "" {
		normalizedMime = sniffedMime
	}
	if !isAllowedMimeForKind(input.Kind, normalizedMime) {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "provided mime type is not allowed")
	}

	checksum := checksumSHA256(input.Payload)

	deduped, dedupeErr := s.repo.FindActiveMediaByChecksum(ctx, input.Principal.AccountID, checksum, input.Domain, input.Kind)
	if dedupeErr == nil {
		return deduped, nil
	}
	if dedupeErr != postgres.ErrNotFound {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeInternal, "failed to check media dedupe state")
	}

	usedBytes, usedErr := s.repo.CountActiveMediaSizeByOwner(ctx, input.Principal.AccountID)
	if usedErr != nil {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeInternal, "failed to calculate media quota")
	}
	if s.cfg.LocalMaxPerUserBytes > 0 && usedBytes+int64(len(input.Payload)) > s.cfg.LocalMaxPerUserBytes {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "media quota exceeded for current account")
	}
	if strings.EqualFold(s.cfg.StorageBackend, "local") && s.cfg.LocalMaxTotalBytes > 0 {
		totalBytes, totalErr := s.repo.CountActiveMediaSizeTotal(ctx)
		if totalErr != nil {
			return domain.MediaObject{}, service.NewError(service.ErrorCodeInternal, "failed to calculate total media quota")
		}
		if totalBytes+int64(len(input.Payload)) > s.cfg.LocalMaxTotalBytes {
			return domain.MediaObject{}, service.NewError(service.ErrorCodeValidation, "server media storage quota exceeded")
		}
	}

	mediaID := security.NewID()
	ext := extensionForMime(normalizedMime)
	safeName := sanitizeBaseName(input.FileName)
	objectKey := fmt.Sprintf("%s/%s/%s_%s%s", input.Principal.AccountID, input.Domain, mediaID, safeName, ext)

	if err := s.storage.Put(ctx, objectKey, input.Payload, normalizedMime); err != nil {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeInternal, "failed to store media object")
	}

	media := domain.MediaObject{
		ID:             mediaID,
		OwnerAccountID: input.Principal.AccountID,
		Domain:         input.Domain,
		Kind:           input.Kind,
		StorageBackend: domain.MediaStorageBackend(strings.ToLower(strings.TrimSpace(s.cfg.StorageBackend))),
		ObjectKey:      objectKey,
		MimeType:       normalizedMime,
		SizeBytes:      int64(len(input.Payload)),
		ChecksumSHA256: checksum,
		Visibility:     input.Visibility,
		Status:         domain.MediaStatusActive,
		CreatedAt:      time.Now().UTC(),
	}
	if strings.EqualFold(s.cfg.StorageBackend, "s3") {
		bucket := strings.TrimSpace(s.cfg.S3Bucket)
		media.Bucket = &bucket
	}
	if input.Domain == domain.MediaDomainStory {
		expiresAt := time.Now().UTC().Add(s.cfg.StoryTTL)
		media.ExpiresAt = &expiresAt
	}

	created, err := s.repo.CreateMediaObject(ctx, media)
	if err != nil {
		_ = s.storage.Delete(ctx, objectKey)
		return domain.MediaObject{}, service.NewError(service.ErrorCodeInternal, "failed to persist media metadata")
	}
	_, _ = s.repo.UpsertMediaVariant(ctx, domain.MediaVariant{
		MediaID:     created.ID,
		VariantType: domain.MediaVariantOriginal,
		ObjectKey:   created.ObjectKey,
		Width:       created.Width,
		Height:      created.Height,
		SizeBytes:   created.SizeBytes,
	})
	return created, nil
}

func (s *Service) GetMedia(ctx context.Context, principal auth.AuthPrincipal, mediaID string) (domain.MediaObject, error) {
	media, err := s.repo.GetMediaObjectByID(ctx, strings.TrimSpace(mediaID))
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.MediaObject{}, service.NewError(service.ErrorCodeNotFound, "media not found")
		}
		return domain.MediaObject{}, service.NewError(service.ErrorCodeInternal, "failed to load media")
	}
	if media.DeletedAt != nil || media.Status != domain.MediaStatusActive {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeNotFound, "media not found")
	}
	if media.ExpiresAt != nil && media.ExpiresAt.Before(time.Now().UTC()) {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeNotFound, "media not found")
	}

	if media.OwnerAccountID == principal.AccountID {
		return media, nil
	}
	canView, visibilityErr := s.privacy.CanView(ctx, media.OwnerAccountID, principal.AccountID, media.Visibility)
	if visibilityErr != nil {
		return domain.MediaObject{}, visibilityErr
	}
	if !canView {
		return domain.MediaObject{}, service.NewError(service.ErrorCodeForbidden, "media access denied")
	}
	return media, nil
}

func (s *Service) Download(ctx context.Context, principal auth.AuthPrincipal, mediaID string) (DownloadResult, error) {
	media, err := s.GetMedia(ctx, principal, mediaID)
	if err != nil {
		return DownloadResult{}, err
	}
	reader, err := s.storage.Open(ctx, media.ObjectKey)
	if err != nil {
		return DownloadResult{}, service.NewError(service.ErrorCodeInternal, "failed to load media content")
	}
	defer reader.Close()

	content, readErr := io.ReadAll(reader)
	if readErr != nil {
		return DownloadResult{}, service.NewError(service.ErrorCodeInternal, "failed to read media content")
	}
	return DownloadResult{Media: media, Content: content}, nil
}

func (s *Service) Delete(ctx context.Context, principal auth.AuthPrincipal, mediaID string) error {
	media, err := s.repo.GetMediaObjectByID(ctx, strings.TrimSpace(mediaID))
	if err != nil {
		if err == postgres.ErrNotFound {
			return service.NewError(service.ErrorCodeNotFound, "media not found")
		}
		return service.NewError(service.ErrorCodeInternal, "failed to load media")
	}
	if media.OwnerAccountID != principal.AccountID {
		return service.NewError(service.ErrorCodeForbidden, "cannot delete other account media")
	}
	ok, err := s.repo.SoftDeleteMediaObject(ctx, media.ID, principal.AccountID)
	if err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to delete media")
	}
	if !ok {
		return service.NewError(service.ErrorCodeNotFound, "media not found")
	}
	_ = s.storage.Delete(ctx, media.ObjectKey)
	return nil
}

func (s *Service) ListByOwner(ctx context.Context, principal auth.AuthPrincipal, domainName *domain.MediaDomain, kind *domain.MediaKind, limit int) ([]domain.MediaObject, error) {
	items, err := s.repo.ListMediaByOwner(ctx, principal.AccountID, domainName, kind, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list media")
	}
	return items, nil
}

func (s *Service) RunCleanupLoop(ctx context.Context, logger *slog.Logger) {
	interval := s.cfg.CleanupInterval
	if interval <= 0 {
		interval = 30 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.RunCleanupIteration(ctx); err != nil && logger != nil {
				logger.Warn("media cleanup iteration failed", "error", err)
			}
		}
	}
}

func (s *Service) RunCleanupIteration(ctx context.Context) error {
	expired, err := s.repo.ListExpiredMedia(ctx, time.Now().UTC(), 300)
	if err != nil {
		return err
	}
	for _, item := range expired {
		if deleteErr := s.storage.Delete(ctx, item.ObjectKey); deleteErr != nil {
			// Keep row active so the next cleanup iteration can retry deletion.
			return deleteErr
		}
		if markErr := s.repo.MarkMediaExpired(ctx, item.ID); markErr != nil {
			return markErr
		}
	}
	return nil
}

func detectMimeType(payload []byte) string {
	sample := payload
	if len(sample) > 512 {
		sample = sample[:512]
	}
	return strings.ToLower(strings.TrimSpace(http.DetectContentType(sample)))
}

func checksumSHA256(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func sanitizeBaseName(fileName string) string {
	base := filepath.Base(strings.TrimSpace(fileName))
	ext := filepath.Ext(base)
	withoutExt := strings.TrimSuffix(base, ext)
	withoutExt = strings.ToLower(strings.TrimSpace(withoutExt))
	if withoutExt == "" {
		return "file"
	}
	builder := strings.Builder{}
	for _, symbol := range withoutExt {
		if (symbol >= 'a' && symbol <= 'z') || (symbol >= '0' && symbol <= '9') || symbol == '-' || symbol == '_' {
			builder.WriteRune(symbol)
			continue
		}
		builder.WriteRune('-')
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "file"
	}
	if len(result) > 40 {
		return result[:40]
	}
	return result
}

func extensionForMime(mime string) string {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "video/quicktime":
		return ".mov"
	default:
		return ".bin"
	}
}

func isValidDomain(value domain.MediaDomain) bool {
	return value == domain.MediaDomainProfile || value == domain.MediaDomainSocial || value == domain.MediaDomainStory
}

func isValidKind(value domain.MediaKind) bool {
	switch value {
	case domain.MediaKindAvatar, domain.MediaKindBanner, domain.MediaKindPhoto, domain.MediaKindVideo, domain.MediaKindStoryImage, domain.MediaKindStoryVideo:
		return true
	default:
		return false
	}
}

func isValidVisibility(value domain.VisibilityScope) bool {
	return value == domain.VisibilityEveryone || value == domain.VisibilityFriends || value == domain.VisibilityOnlyMe
}

func isAllowedMimeForKind(kind domain.MediaKind, mime string) bool {
	normalized := strings.ToLower(strings.TrimSpace(mime))
	switch kind {
	case domain.MediaKindAvatar, domain.MediaKindBanner, domain.MediaKindPhoto, domain.MediaKindStoryImage:
		return normalized == "image/jpeg" || normalized == "image/png" || normalized == "image/webp" || normalized == "image/gif"
	case domain.MediaKindVideo, domain.MediaKindStoryVideo:
		return normalized == "video/mp4" || normalized == "video/webm" || normalized == "video/quicktime"
	default:
		return false
	}
}

func (s *Service) resolveSizeLimit(kind domain.MediaKind) int64 {
	switch kind {
	case domain.MediaKindAvatar:
		return s.cfg.MaxAvatarBytes
	case domain.MediaKindBanner:
		return s.cfg.MaxBannerBytes
	case domain.MediaKindPhoto, domain.MediaKindStoryImage:
		return s.cfg.MaxPhotoBytes
	case domain.MediaKindVideo, domain.MediaKindStoryVideo:
		return s.cfg.MaxVideoBytes
	default:
		return s.cfg.MaxPhotoBytes
	}
}

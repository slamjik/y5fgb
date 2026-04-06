package social

import (
	"testing"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
)

func TestNormalizeMedia(t *testing.T) {
	imageType := domain.SocialMediaTypeImage
	videoType := domain.SocialMediaTypeVideo
	badType := domain.SocialMediaType("audio")

	tests := []struct {
		name      string
		mediaType *domain.SocialMediaType
		mediaURL  *string
		wantErr   bool
	}{
		{
			name:      "no media",
			mediaType: nil,
			mediaURL:  nil,
			wantErr:   false,
		},
		{
			name:      "valid image media",
			mediaType: &imageType,
			mediaURL:  ptr("https://cdn.example.com/image.png"),
			wantErr:   false,
		},
		{
			name:      "valid video media",
			mediaType: &videoType,
			mediaURL:  ptr("http://cdn.example.com/video.mp4"),
			wantErr:   false,
		},
		{
			name:      "missing media type",
			mediaType: nil,
			mediaURL:  ptr("https://cdn.example.com/file"),
			wantErr:   true,
		},
		{
			name:      "invalid media type",
			mediaType: &badType,
			mediaURL:  ptr("https://cdn.example.com/file"),
			wantErr:   true,
		},
		{
			name:      "invalid media url scheme",
			mediaType: &imageType,
			mediaURL:  ptr("ftp://cdn.example.com/image.png"),
			wantErr:   true,
		},
	}

	for _, testCase := range tests {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			_, _, err := normalizeMedia(testCase.mediaType, testCase.mediaURL)
			if testCase.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !testCase.wantErr && err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}
}

func TestNormalizeMood(t *testing.T) {
	valid := "радость"
	got, err := normalizeMood(&valid)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got == nil || *got != valid {
		t.Fatalf("unexpected mood result")
	}

	blank := "   "
	got, err = normalizeMood(&blank)
	if err != nil {
		t.Fatalf("expected no error for blank mood, got %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil mood for blank input")
	}
}

func ptr(value string) *string {
	return &value
}

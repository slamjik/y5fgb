package postgres

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) GetUserProfileByAccountID(ctx context.Context, accountID string) (domain.UserProfile, error) {
	var profile domain.UserProfile
	var birthDate *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT
			account_id,
			display_name,
			username,
			bio,
			status_text,
			birth_date,
			location,
			website_url,
			avatar_media_id,
			banner_media_id,
			username_changed_at,
			created_at,
			updated_at
		FROM user_profiles
		WHERE account_id = $1
	`, accountID).Scan(
		&profile.AccountID,
		&profile.DisplayName,
		&profile.Username,
		&profile.Bio,
		&profile.StatusText,
		&birthDate,
		&profile.Location,
		&profile.WebsiteURL,
		&profile.AvatarMediaID,
		&profile.BannerMediaID,
		&profile.UsernameChangedAt,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserProfile{}, ErrNotFound
		}
		return domain.UserProfile{}, fmt.Errorf("failed to get user profile by account id: %w", err)
	}
	profile.BirthDate = birthDate
	profile.Location = normalizeNullableText(profile.Location)
	profile.WebsiteURL = normalizeNullableText(profile.WebsiteURL)
	return profile, nil
}

func (s *Store) EnsureDefaultProfileAndPrivacy(ctx context.Context, account domain.Account) error {
	accountID := strings.TrimSpace(account.ID)
	if accountID == "" {
		return fmt.Errorf("account id is required")
	}

	displayName := defaultDisplayNameFromEmail(account.Email)
	username := defaultUsernameFromAccount(account.ID, account.Email)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_profiles (
			account_id,
			display_name,
			username,
			bio,
			status_text,
			location,
			website_url,
			created_at,
			updated_at
		)
		VALUES ($1, $2, $3, '', '', '', '', NOW(), NOW())
		ON CONFLICT (account_id) DO NOTHING
	`, accountID, displayName, username)
	if err != nil {
		return fmt.Errorf("failed to ensure default user profile: %w", err)
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO profile_privacy_settings (
			account_id,
			profile_visibility,
			posts_visibility,
			photos_visibility,
			stories_visibility,
			friends_visibility,
			birth_date_visibility,
			location_visibility,
			links_visibility,
			friend_requests_policy,
			dm_policy,
			updated_at
		)
		VALUES ($1, 'everyone', 'friends', 'friends', 'friends', 'friends', 'friends', 'friends', 'friends', 'everyone', 'friends', NOW())
		ON CONFLICT (account_id) DO NOTHING
	`, accountID)
	if err != nil {
		return fmt.Errorf("failed to ensure default profile privacy settings: %w", err)
	}

	return nil
}

func (s *Store) GetUserProfileByUsername(ctx context.Context, username string) (domain.UserProfile, error) {
	var profile domain.UserProfile
	var birthDate *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT
			account_id,
			display_name,
			username,
			bio,
			status_text,
			birth_date,
			location,
			website_url,
			avatar_media_id,
			banner_media_id,
			username_changed_at,
			created_at,
			updated_at
		FROM user_profiles
		WHERE LOWER(username) = LOWER($1)
	`, strings.TrimSpace(username)).Scan(
		&profile.AccountID,
		&profile.DisplayName,
		&profile.Username,
		&profile.Bio,
		&profile.StatusText,
		&birthDate,
		&profile.Location,
		&profile.WebsiteURL,
		&profile.AvatarMediaID,
		&profile.BannerMediaID,
		&profile.UsernameChangedAt,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserProfile{}, ErrNotFound
		}
		return domain.UserProfile{}, fmt.Errorf("failed to get user profile by username: %w", err)
	}
	profile.BirthDate = birthDate
	profile.Location = normalizeNullableText(profile.Location)
	profile.WebsiteURL = normalizeNullableText(profile.WebsiteURL)
	return profile, nil
}

func (s *Store) SearchUserProfiles(ctx context.Context, query string, limit int) ([]domain.UserSearchItem, error) {
	normalizedQuery := strings.TrimSpace(strings.ToLower(query))
	if normalizedQuery == "" {
		return []domain.UserSearchItem{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	pattern := "%" + normalizedQuery + "%"

	rows, err := s.pool.Query(ctx, `
		SELECT
			p.account_id,
			a.email,
			p.username,
			p.display_name,
			p.avatar_media_id,
			a.created_at
		FROM user_profiles p
		JOIN accounts a ON a.id = p.account_id
		WHERE LOWER(p.username) LIKE $1
		   OR LOWER(p.display_name) LIKE $1
		ORDER BY
			CASE
				WHEN LOWER(p.username) = $2 THEN 0
				WHEN LOWER(p.username) LIKE $3 THEN 1
				ELSE 2
			END,
			p.updated_at DESC
		LIMIT $4
	`, pattern, normalizedQuery, normalizedQuery+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("failed to search user profiles: %w", err)
	}
	defer rows.Close()

	result := make([]domain.UserSearchItem, 0, limit)
	for rows.Next() {
		var item domain.UserSearchItem
		if scanErr := rows.Scan(
			&item.AccountID,
			&item.Email,
			&item.Username,
			&item.Display,
			&item.AvatarID,
			&item.CreatedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan user profile search row: %w", scanErr)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate user profile search rows: %w", err)
	}
	return result, nil
}

func (s *Store) UpdateUserProfile(ctx context.Context, profile domain.UserProfile) (domain.UserProfile, error) {
	err := s.pool.QueryRow(ctx, `
		UPDATE user_profiles
		SET
			display_name = $2,
			username = $3,
			bio = $4,
			status_text = $5,
			birth_date = $6,
			location = COALESCE($7, ''),
			website_url = COALESCE($8, ''),
			avatar_media_id = $9,
			banner_media_id = $10,
			username_changed_at = $11,
			updated_at = NOW()
		WHERE account_id = $1
		RETURNING created_at, updated_at
	`, profile.AccountID, profile.DisplayName, profile.Username, profile.Bio, profile.StatusText, profile.BirthDate, nullableText(profile.Location), nullableText(profile.WebsiteURL), profile.AvatarMediaID, profile.BannerMediaID, profile.UsernameChangedAt).Scan(
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)
	if err != nil {
		return domain.UserProfile{}, normalizeWriteError(fmt.Errorf("failed to update user profile: %w", err))
	}
	return profile, nil
}

func (s *Store) GetProfilePrivacySettings(ctx context.Context, accountID string) (domain.ProfilePrivacySettings, error) {
	var settings domain.ProfilePrivacySettings
	err := s.pool.QueryRow(ctx, `
		SELECT
			account_id,
			profile_visibility,
			posts_visibility,
			photos_visibility,
			stories_visibility,
			friends_visibility,
			birth_date_visibility,
			location_visibility,
			links_visibility,
			friend_requests_policy,
			dm_policy,
			updated_at
		FROM profile_privacy_settings
		WHERE account_id = $1
	`, accountID).Scan(
		&settings.AccountID,
		&settings.ProfileVisibility,
		&settings.PostsVisibility,
		&settings.PhotosVisibility,
		&settings.StoriesVisibility,
		&settings.FriendsVisibility,
		&settings.BirthDateVisibility,
		&settings.LocationVisibility,
		&settings.LinksVisibility,
		&settings.FriendRequestsPolicy,
		&settings.DMPolicy,
		&settings.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ProfilePrivacySettings{}, ErrNotFound
		}
		return domain.ProfilePrivacySettings{}, fmt.Errorf("failed to get profile privacy settings: %w", err)
	}
	return settings, nil
}

func (s *Store) UpsertProfilePrivacySettings(ctx context.Context, settings domain.ProfilePrivacySettings) (domain.ProfilePrivacySettings, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO profile_privacy_settings (
			account_id,
			profile_visibility,
			posts_visibility,
			photos_visibility,
			stories_visibility,
			friends_visibility,
			birth_date_visibility,
			location_visibility,
			links_visibility,
			friend_requests_policy,
			dm_policy,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
		ON CONFLICT (account_id) DO UPDATE SET
			profile_visibility = EXCLUDED.profile_visibility,
			posts_visibility = EXCLUDED.posts_visibility,
			photos_visibility = EXCLUDED.photos_visibility,
			stories_visibility = EXCLUDED.stories_visibility,
			friends_visibility = EXCLUDED.friends_visibility,
			birth_date_visibility = EXCLUDED.birth_date_visibility,
			location_visibility = EXCLUDED.location_visibility,
			links_visibility = EXCLUDED.links_visibility,
			friend_requests_policy = EXCLUDED.friend_requests_policy,
			dm_policy = EXCLUDED.dm_policy,
			updated_at = NOW()
		RETURNING updated_at
	`, settings.AccountID, settings.ProfileVisibility, settings.PostsVisibility, settings.PhotosVisibility, settings.StoriesVisibility, settings.FriendsVisibility, settings.BirthDateVisibility, settings.LocationVisibility, settings.LinksVisibility, settings.FriendRequestsPolicy, settings.DMPolicy).Scan(
		&settings.UpdatedAt,
	)
	if err != nil {
		return domain.ProfilePrivacySettings{}, fmt.Errorf("failed to upsert profile privacy settings: %w", err)
	}
	return settings, nil
}

func normalizeNullableText(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func nullableText(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

var usernameAllowedCharsPattern = regexp.MustCompile(`[^a-z0-9._-]+`)

func defaultDisplayNameFromEmail(email string) string {
	local := strings.TrimSpace(strings.Split(strings.ToLower(strings.TrimSpace(email)), "@")[0])
	if local == "" {
		return "user"
	}
	if len(local) > 64 {
		return local[:64]
	}
	return local
}

func defaultUsernameFromAccount(accountID string, email string) string {
	local := strings.TrimSpace(strings.Split(strings.ToLower(strings.TrimSpace(email)), "@")[0])
	base := usernameAllowedCharsPattern.ReplaceAllString(local, "")
	base = strings.Trim(base, "._-")
	if base == "" {
		base = "user"
	}

	suffix := strings.ReplaceAll(strings.TrimSpace(accountID), "-", "")
	if len(suffix) > 6 {
		suffix = suffix[:6]
	}
	if suffix == "" {
		suffix = "000000"
	}

	const maxUsernameLength = 24
	maxBaseLen := maxUsernameLength - 1 - len(suffix)
	if maxBaseLen < 3 {
		maxBaseLen = 3
	}
	if len(base) > maxBaseLen {
		base = base[:maxBaseLen]
	}
	base = strings.Trim(base, "._-")
	if base == "" {
		base = "user"
		if len(base) > maxBaseLen {
			base = base[:maxBaseLen]
		}
	}
	return base + "_" + suffix
}

package domain

import "time"

type DeviceStatus string

const (
	DeviceStatusPending DeviceStatus = "pending"
	DeviceStatusTrusted DeviceStatus = "trusted"
	DeviceStatusRevoked DeviceStatus = "revoked"
	DeviceStatusBlocked DeviceStatus = "blocked"
)

type VerificationState string

const (
	VerificationStateUnverified VerificationState = "unverified"
	VerificationStateVerified   VerificationState = "verified"
	VerificationStateChanged    VerificationState = "changed"
	VerificationStateRevoked    VerificationState = "revoked"
)

type ApprovalStatus string

const (
	ApprovalStatusPending  ApprovalStatus = "pending"
	ApprovalStatusApproved ApprovalStatus = "approved"
	ApprovalStatusRejected ApprovalStatus = "rejected"
	ApprovalStatusExpired  ApprovalStatus = "expired"
)

type SessionStatus string

const (
	SessionStatusActive  SessionStatus = "active"
	SessionStatusRevoked SessionStatus = "revoked"
	SessionStatusExpired SessionStatus = "expired"
)

type ClientPlatform string

const (
	ClientPlatformDesktopTauri ClientPlatform = "desktop-tauri"
	ClientPlatformWebBrowser   ClientPlatform = "web-browser"
)

type SessionClass string

const (
	SessionClassDevice  SessionClass = "device"
	SessionClassBrowser SessionClass = "browser"
)

type RecoveryFlowStatus string

const (
	RecoveryFlowStatusStarted   RecoveryFlowStatus = "started"
	RecoveryFlowStatusCompleted RecoveryFlowStatus = "completed"
	RecoveryFlowStatusExpired   RecoveryFlowStatus = "expired"
)

type SecurityEventType string

const (
	SecurityEventAccountRegistered    SecurityEventType = "account_registered"
	SecurityEventLoginSuccess         SecurityEventType = "login_success"
	SecurityEventLoginFailed          SecurityEventType = "login_failed"
	SecurityEventTwoFAEnabled         SecurityEventType = "two_fa_enabled"
	SecurityEventTwoFADisabled        SecurityEventType = "two_fa_disabled"
	SecurityEventDeviceAdded          SecurityEventType = "device_added"
	SecurityEventDevicePending        SecurityEventType = "device_pending"
	SecurityEventDeviceApproved       SecurityEventType = "device_approved"
	SecurityEventDeviceRejected       SecurityEventType = "device_rejected"
	SecurityEventDeviceRevoked        SecurityEventType = "device_revoked"
	SecurityEventDeviceKeyChanged     SecurityEventType = "device_key_changed"
	SecurityEventIdentityChanged      SecurityEventType = "identity_changed"
	SecurityEventRecoveryUsed         SecurityEventType = "recovery_used"
	SecurityEventRefreshTokenReuse    SecurityEventType = "refresh_token_reuse_detected"
	SecurityEventMessageSent          SecurityEventType = "message_sent"
	SecurityEventMessageDelivered     SecurityEventType = "message_delivered"
	SecurityEventMessageFailed        SecurityEventType = "message_failed"
	SecurityEventAttachmentUploaded   SecurityEventType = "attachment_uploaded"
	SecurityEventAttachmentDownloaded SecurityEventType = "attachment_downloaded"
	SecurityEventTransportSwitched    SecurityEventType = "transport_switched"
)

type SecurityEventSeverity string

const (
	SecurityEventSeverityInfo     SecurityEventSeverity = "info"
	SecurityEventSeverityWarning  SecurityEventSeverity = "warning"
	SecurityEventSeverityCritical SecurityEventSeverity = "critical"
)

type Account struct {
	ID           string
	Email        string
	PasswordHash string
	TwoFAEnabled bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type ConversationType string

const (
	ConversationTypeDirect ConversationType = "direct"
	ConversationTypeGroup  ConversationType = "group"
)

type ConversationRole string

const (
	ConversationRoleOwner  ConversationRole = "owner"
	ConversationRoleAdmin  ConversationRole = "admin"
	ConversationRoleMember ConversationRole = "member"
)

type DeliveryState string

const (
	DeliveryStatePending   DeliveryState = "pending"
	DeliveryStateQueued    DeliveryState = "queued"
	DeliveryStateSent      DeliveryState = "sent"
	DeliveryStateDelivered DeliveryState = "delivered"
	DeliveryStateFailed    DeliveryState = "failed"
	DeliveryStateExpired   DeliveryState = "expired"
)

type ReceiptType string

const (
	ReceiptTypeDelivered ReceiptType = "delivered"
	ReceiptTypeRead      ReceiptType = "read"
)

type AttachmentKind string

const (
	AttachmentKindImage AttachmentKind = "image"
	AttachmentKindFile  AttachmentKind = "file"
)

type SocialMediaType string

const (
	SocialMediaTypeImage SocialMediaType = "image"
	SocialMediaTypeVideo SocialMediaType = "video"
)

type VisibilityScope string

const (
	VisibilityEveryone VisibilityScope = "everyone"
	VisibilityFriends  VisibilityScope = "friends"
	VisibilityOnlyMe   VisibilityScope = "only_me"
)

type FriendRequestPolicy string

const (
	FriendRequestPolicyEveryone FriendRequestPolicy = "everyone"
	FriendRequestPolicyFriends  FriendRequestPolicy = "friends"
	FriendRequestPolicyNobody   FriendRequestPolicy = "nobody"
)

type DMPolicy string

const (
	DMPolicyEveryone DMPolicy = "everyone"
	DMPolicyFriends  DMPolicy = "friends"
	DMPolicyNobody   DMPolicy = "nobody"
)

type FriendRequestStatus string

const (
	FriendRequestStatusPending   FriendRequestStatus = "pending"
	FriendRequestStatusAccepted  FriendRequestStatus = "accepted"
	FriendRequestStatusRejected  FriendRequestStatus = "rejected"
	FriendRequestStatusCancelled FriendRequestStatus = "cancelled"
)

type FriendRelationState string

const (
	FriendRelationNone     FriendRelationState = "none"
	FriendRelationIncoming FriendRelationState = "incoming"
	FriendRelationOutgoing FriendRelationState = "outgoing"
	FriendRelationFriends  FriendRelationState = "friends"
	FriendRelationBlocked  FriendRelationState = "blocked"
)

type MediaDomain string

const (
	MediaDomainProfile MediaDomain = "profile"
	MediaDomainSocial  MediaDomain = "social"
	MediaDomainStory   MediaDomain = "story"
)

type MediaKind string

const (
	MediaKindAvatar     MediaKind = "avatar"
	MediaKindBanner     MediaKind = "banner"
	MediaKindPhoto      MediaKind = "photo"
	MediaKindVideo      MediaKind = "video"
	MediaKindStoryImage MediaKind = "story_image"
	MediaKindStoryVideo MediaKind = "story_video"
)

type MediaStorageBackend string

const (
	MediaStorageBackendLocal MediaStorageBackend = "local"
	MediaStorageBackendS3    MediaStorageBackend = "s3"
)

type MediaStatus string

const (
	MediaStatusActive  MediaStatus = "active"
	MediaStatusDeleted MediaStatus = "deleted"
	MediaStatusExpired MediaStatus = "expired"
)

type MediaVariantType string

const (
	MediaVariantThumb    MediaVariantType = "thumb"
	MediaVariantPreview  MediaVariantType = "preview"
	MediaVariantOriginal MediaVariantType = "original"
)

type NotificationType string

const (
	NotificationTypeSocialLike     NotificationType = "social_like"
	NotificationTypeFriendRequest  NotificationType = "friend_request"
	NotificationTypeFriendAccepted NotificationType = "friend_accepted"
	NotificationTypeStoryPublished NotificationType = "story_published"
)

type NotificationNavigationTarget string

const (
	NotificationNavigationTargetProfile        NotificationNavigationTarget = "profile"
	NotificationNavigationTargetChat           NotificationNavigationTarget = "chat"
	NotificationNavigationTargetPost           NotificationNavigationTarget = "post"
	NotificationNavigationTargetFriendsRequest NotificationNavigationTarget = "friends_requests"
)

type TransportMode string

const (
	TransportModeWebSocket TransportMode = "websocket"
	TransportModeLongPoll  TransportMode = "long_poll"
)

type Conversation struct {
	ID                 string
	Type               ConversationType
	Title              *string
	CreatedByAccountID string
	DefaultTTLSeconds  int
	AllowTTLOverride   bool
	LastServerSequence int64
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type ConversationSummaryLastMessage struct {
	ID              string
	SenderAccountID string
	SenderDeviceID  string
	CreatedAt       time.Time
	ServerSequence  int64
	DeliveryState   DeliveryState
}

type ConversationSummary struct {
	Conversation        Conversation
	MembersCount        int
	DirectPeerAccountID *string
	DirectPeerEmail     *string
	LastMessage         *ConversationSummaryLastMessage
}

type ConversationMember struct {
	ConversationID string
	AccountID      string
	Role           ConversationRole
	JoinedAt       time.Time
	IsActive       bool
}

type MessageEnvelope struct {
	ID               string
	ConversationID   string
	SenderAccountID  string
	SenderDeviceID   string
	ClientMessageID  string
	Algorithm        string
	CryptoVersion    int
	Nonce            string
	Ciphertext       string
	ReplyToMessageID *string
	TTLSeconds       *int
	ExpiresAt        *time.Time
	ServerSequence   int64
	CreatedAt        time.Time
	EditedAt         *time.Time
	DeletedAt        *time.Time
}

type MessageRecipient struct {
	MessageID          string
	RecipientAccountID string
	RecipientDeviceID  string
	WrappedKey         string
	KeyAlgorithm       string
	DeliveryState      DeliveryState
	QueuedAt           time.Time
	DeliveredAt        *time.Time
	FailedReason       *string
}

type MessageReceipt struct {
	ID          string
	MessageID   string
	DeviceID    string
	ReceiptType ReceiptType
	Sequence    int64
	CreatedAt   time.Time
}

type AttachmentObject struct {
	ID             string
	AccountID      string
	Kind           AttachmentKind
	FileName       string
	MimeType       string
	SizeBytes      int64
	ChecksumSHA256 string
	Algorithm      string
	Nonce          string
	StoragePath    string
	CreatedAt      time.Time
	ExpiresAt      *time.Time
	MessageID      *string
}

type AttachmentRef struct {
	MessageID    string
	AttachmentID string
	CreatedAt    time.Time
}

type SocialPost struct {
	ID              string
	AuthorAccountID string
	Content         string
	MediaType       *SocialMediaType
	MediaURL        *string
	MediaID         *string
	Mood            *string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DeletedAt       *time.Time
}

type SocialPostFeedItem struct {
	Post              SocialPost
	AuthorEmail       string
	AuthorDisplayName string
	AuthorUsername    string
	AuthorAvatarID    *string
	Media             *MediaObject
	LikeCount         int64
	LikedByMe         bool
}

type SocialPostLike struct {
	PostID    string
	AccountID string
	CreatedAt time.Time
}

type SocialNotification struct {
	PostID         string
	ActorAccountID string
	ActorEmail     string
	PostPreview    string
	CreatedAt      time.Time
}

type DeviceSyncCursor struct {
	CursorID   string
	DeviceID   string
	LastCursor int64
	UpdatedAt  time.Time
}

type TransportEndpoint struct {
	ID       string
	URL      string
	Mode     TransportMode
	Priority int
	Enabled  bool
}

type AccountIdentity struct {
	AccountID              string
	PublicIdentityMaterial string
	Fingerprint            string
	VerificationState      VerificationState
	TrustState             string
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

type UserSearchItem struct {
	AccountID string
	Email     string
	Username  string
	Display   string
	AvatarID  *string
	CreatedAt time.Time
}

type UserPublicProfile struct {
	AccountID                  string
	Email                      string
	DisplayName                string
	Username                   string
	Bio                        string
	StatusText                 string
	Location                   *string
	WebsiteURL                 *string
	BirthDate                  *time.Time
	AvatarMediaID              *string
	BannerMediaID              *string
	FriendState                FriendRelationState
	Privacy                    ProfilePrivacySettings
	CreatedAt                  time.Time
	PostCount                  int64
	PhotoCount                 int64
	FriendCount                int64
	CanStartDirectChat         bool
	ExistingDirectConversation *string
	CanViewPosts               bool
	CanViewPhotos              bool
	CanViewStories             bool
	CanViewFriends             bool
	CanSendFriendRequest       bool
}

type UserProfile struct {
	AccountID         string
	DisplayName       string
	Username          string
	Bio               string
	StatusText        string
	BirthDate         *time.Time
	Location          *string
	WebsiteURL        *string
	AvatarMediaID     *string
	BannerMediaID     *string
	UsernameChangedAt *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type ProfilePrivacySettings struct {
	AccountID            string
	ProfileVisibility    VisibilityScope
	PostsVisibility      VisibilityScope
	PhotosVisibility     VisibilityScope
	StoriesVisibility    VisibilityScope
	FriendsVisibility    VisibilityScope
	BirthDateVisibility  VisibilityScope
	LocationVisibility   VisibilityScope
	LinksVisibility      VisibilityScope
	FriendRequestsPolicy FriendRequestPolicy
	DMPolicy             DMPolicy
	UpdatedAt            time.Time
}

type FriendRequest struct {
	ID            string
	FromAccountID string
	ToAccountID   string
	Status        FriendRequestStatus
	ActedBy       *string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type FriendListItem struct {
	AccountID   string
	Username    string
	DisplayName string
	AvatarID    *string
	CreatedAt   time.Time
}

type FriendRequestListItem struct {
	Request    FriendRequest
	Actor      FriendListItem
	Target     FriendListItem
	Direction  string
	IsOutgoing bool
}

type Friendship struct {
	AccountAID string
	AccountBID string
	CreatedAt  time.Time
}

type UserBlock struct {
	BlockerAccountID string
	BlockedAccountID string
	CreatedAt        time.Time
}

type MediaObject struct {
	ID             string
	OwnerAccountID string
	Domain         MediaDomain
	Kind           MediaKind
	StorageBackend MediaStorageBackend
	Bucket         *string
	ObjectKey      string
	MimeType       string
	SizeBytes      int64
	ChecksumSHA256 string
	Width          *int
	Height         *int
	DurationMS     *int64
	Visibility     VisibilityScope
	Status         MediaStatus
	CreatedAt      time.Time
	ExpiresAt      *time.Time
	DeletedAt      *time.Time
}

type MediaVariant struct {
	MediaID     string
	VariantType MediaVariantType
	ObjectKey   string
	Width       *int
	Height      *int
	SizeBytes   int64
}

type Story struct {
	ID             string
	OwnerAccountID string
	MediaID        string
	Caption        string
	Visibility     VisibilityScope
	ExpiresAt      time.Time
	CreatedAt      time.Time
	DeletedAt      *time.Time
}

type StoryFeedItem struct {
	Story       Story
	OwnerName   string
	OwnerUser   string
	OwnerAvatar *string
	Media       *MediaObject
}

type AppNotification struct {
	ID             string
	Type           NotificationType
	ActorAccountID *string
	ActorName      *string
	ActorUsername  *string
	TargetID       *string
	Preview        *string
	IsRead         bool
	ReadAt         *time.Time
	Navigation     *NotificationNavigation
	CreatedAt      time.Time
}

type NotificationNavigation struct {
	Target         NotificationNavigationTarget
	AccountID      *string
	ConversationID *string
	PostID         *string
}

type Device struct {
	ID                   string
	AccountID            string
	Name                 string
	Platform             string
	PublicDeviceMaterial string
	Fingerprint          string
	Status               DeviceStatus
	VerificationState    VerificationState
	KeyVersion           int
	RotatedAt            *time.Time
	RotationDueAt        *time.Time
	CreatedAt            time.Time
	LastSeenAt           *time.Time
	RevokedAt            *time.Time
}

type DeviceApprovalRequest struct {
	ID                 string
	AccountID          string
	DeviceID           string
	Status             ApprovalStatus
	ApprovedByDeviceID *string
	PollTokenHash      string
	PollExpiresAt      time.Time
	CreatedAt          time.Time
	ResolvedAt         *time.Time
}

type Session struct {
	ID                       string
	AccountID                string
	DeviceID                 string
	ClientPlatform           ClientPlatform
	SessionClass             SessionClass
	Persistent               bool
	AccessTokenHash          string
	RefreshTokenHash         string
	PreviousRefreshTokenHash *string
	Status                   SessionStatus
	AccessTokenExpiresAt     time.Time
	RefreshTokenExpiresAt    time.Time
	CreatedAt                time.Time
	LastSeenAt               *time.Time
	RevokedAt                *time.Time
}

type TwoFactorSecret struct {
	AccountID       string
	EncryptedSecret string
	Nonce           string
	IsEnabled       bool
	EnabledAt       *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type TwoFactorChallenge struct {
	ID               string
	AccountID        string
	DeviceID         string
	ChallengeType    string
	PendingTokenHash string
	Status           string
	ExpiresAt        time.Time
	CreatedAt        time.Time
	VerifiedAt       *time.Time
}

type RecoveryCode struct {
	ID        string
	AccountID string
	CodeHash  string
	UsedAt    *time.Time
	CreatedAt time.Time
}

type RecoveryFlow struct {
	ID               string
	AccountID        string
	PendingDeviceID  string
	Status           RecoveryFlowStatus
	FlowTokenHash    string
	ExpiresAt        time.Time
	StartedAt        time.Time
	CompletedAt      *time.Time
	UsedRecoveryCode *string
}

type SecurityEvent struct {
	ID         string
	AccountID  string
	DeviceID   *string
	EventType  SecurityEventType
	Severity   SecurityEventSeverity
	TrustState string
	Metadata   []byte
	CreatedAt  time.Time
}

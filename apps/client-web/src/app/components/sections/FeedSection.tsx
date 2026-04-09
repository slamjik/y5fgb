import type { CreateSocialPostResponse } from "@project/protocol";

import type { CreatePostPayload } from "../CreatePost";
import { CreatePost } from "../CreatePost";
import { PostCard } from "../PostCard";
import { InlineInfo } from "../common/StatusInfo";
import type { UploadFeedback } from "../../types";

type FeedSectionProps = {
  postsLoading: boolean;
  postsError: string;
  posts: CreateSocialPostResponse["post"][];
  accessToken: string;
  uploadStatus: UploadFeedback;
  onSubmit: (payload: CreatePostPayload) => Promise<void>;
  onToggleLike: (postId: string, likedByMe: boolean) => Promise<void>;
  onDeletePost: (postId: string) => Promise<void>;
  onOpenProfile: (accountId: string) => Promise<void> | void;
};

export function FeedSection({
  postsLoading,
  postsError,
  posts,
  accessToken,
  uploadStatus,
  onSubmit,
  onToggleLike,
  onDeletePost,
  onOpenProfile,
}: FeedSectionProps) {
  return (
    <section className="space-y-4 app-section-transition">
      <CreatePost onSubmit={onSubmit} uploadStatus={uploadStatus} />
      {postsLoading ? <InlineInfo text="Загрузка ленты..." /> : null}
      {postsError ? <InlineInfo tone="error" text={postsError} /> : null}
      {posts.map((post) => (
        <PostCard
          key={post.id as string}
          id={post.id as string}
          authorDisplayName={post.authorDisplayName || post.authorUsername || post.authorEmail}
          authorUsername={post.authorUsername}
          timestamp={new Date(post.createdAt as string).toLocaleString("ru-RU")}
          imageUrl={post.mediaType === "image" ? post.mediaUrl : null}
          videoUrl={post.mediaType === "video" ? post.mediaUrl : null}
          media={post.media ? { contentUrl: post.media.contentUrl, mimeType: post.media.mimeType } : null}
          accessToken={accessToken}
          caption={post.content}
          likes={post.likeCount}
          likedByMe={post.likedByMe}
          mood={post.mood}
          canDelete={post.canDelete}
          onToggleLike={onToggleLike}
          onDelete={onDeletePost}
          onOpenAuthor={() => onOpenProfile(post.authorAccountId as string)}
        />
      ))}
    </section>
  );
}

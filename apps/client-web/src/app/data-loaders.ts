import type {
  AuthSessionResponse,
  ConversationSummaryDTO,
  CreateSocialPostResponse,
  DeviceListResponse,
  FriendListItemDTO,
  FriendRequestDTO,
  NotificationsResponse,
  PrivacyResponse,
  ProfileDTO,
  SecurityEventsResponse,
  StoryDTO,
} from "@project/protocol";
import type React from "react";

import type { WebApiClient } from "../shared/api/client";
import type { SessionState } from "./types";

export async function loadProfilePosts(
  api: WebApiClient,
  session: SessionState,
  setPosts: React.Dispatch<React.SetStateAction<CreateSocialPostResponse["post"][]>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  accountId?: string,
) {
  setLoading(true);
  try {
    if (accountId && accountId !== session.accountId) {
      const response = await api.listPosts(session.accessToken, { limit: 80, mediaType: "all" });
      setPosts(response.posts.filter((item) => (item.authorAccountId as string) === accountId));
    } else {
      const response = await api.listPosts(session.accessToken, { scope: "mine", limit: 30 });
      setPosts(response.posts);
    }
  } catch {
    setPosts([]);
  } finally {
    setLoading(false);
  }
}

export async function loadSummaries(
  api: WebApiClient,
  session: SessionState,
  setSummaries: React.Dispatch<React.SetStateAction<ConversationSummaryDTO[]>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
  setActiveConversation: React.Dispatch<React.SetStateAction<string | null>>,
) {
  setLoading(true);
  setError("");
  try {
    const response = await api.listConversationSummaries(session.accessToken, { limit: 100, offset: 0 });
    setSummaries(response.summaries);
    if (response.summaries.length > 0) {
      setActiveConversation((current) => current ?? (response.summaries[0].id as string));
    }
  } catch (error) {
    setSummaries([]);
    setError(error instanceof Error ? error.message : "Не удалось загрузить чаты.");
  } finally {
    setLoading(false);
  }
}

export async function loadFeed(
  api: WebApiClient,
  session: SessionState,
  setPosts: React.Dispatch<React.SetStateAction<CreateSocialPostResponse["post"][]>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
  toUserError: (error: unknown) => string,
) {
  setLoading(true);
  setError("");
  try {
    const response = await api.listPosts(session.accessToken, { limit: 30, mediaType: "all" });
    setPosts(response.posts);
  } catch (error) {
    setPosts([]);
    setError(toUserError(error));
  } finally {
    setLoading(false);
  }
}

export async function loadNotifications(
  api: WebApiClient,
  session: SessionState,
  setNotifications: React.Dispatch<React.SetStateAction<NotificationsResponse["notifications"]>>,
) {
  const response = await api.listNotifications(session.accessToken, 50).catch(() => ({ notifications: [], total: 0 }));
  setNotifications(response.notifications);
}

export async function loadProfileState(
  api: WebApiClient,
  session: SessionState,
  setMyProfile: React.Dispatch<React.SetStateAction<ProfileDTO | null>>,
  setProfileEdit: React.Dispatch<
    React.SetStateAction<{
      displayName: string;
      username: string;
      bio: string;
      statusText: string;
      location: string;
      websiteUrl: string;
    }>
  >,
  setFriends: React.Dispatch<React.SetStateAction<FriendListItemDTO[]>>,
  setIncomingRequests: React.Dispatch<React.SetStateAction<FriendRequestDTO[]>>,
  setOutgoingRequests: React.Dispatch<React.SetStateAction<FriendRequestDTO[]>>,
  setPrivacy: React.Dispatch<React.SetStateAction<PrivacyResponse["privacy"] | null>>,
  setStories: React.Dispatch<React.SetStateAction<StoryDTO[]>>,
) {
  const [profile, friends, incoming, outgoing, privacy, stories] = await Promise.all([
    api.getMyProfile(session.accessToken).catch(() => null),
    api.listFriends(session.accessToken, 200).catch(() => ({ friends: [] })),
    api.listFriendRequests(session.accessToken, "incoming", 200).catch(() => ({ requests: [] })),
    api.listFriendRequests(session.accessToken, "outgoing", 200).catch(() => ({ requests: [] })),
    api.getPrivacy(session.accessToken).catch(() => null),
    api.listStoryFeed(session.accessToken, 60).catch(() => ({ stories: [] })),
  ]);

  setMyProfile(profile?.profile ?? null);
  setProfileEdit({
    displayName: profile?.profile.displayName ?? "",
    username: profile?.profile.username ?? "",
    bio: profile?.profile.bio ?? "",
    statusText: profile?.profile.statusText ?? "",
    location: profile?.profile.location ?? "",
    websiteUrl: profile?.profile.websiteUrl ?? "",
  });
  setFriends(friends.friends ?? []);
  setIncomingRequests(incoming.requests ?? []);
  setOutgoingRequests(outgoing.requests ?? []);
  setPrivacy(privacy?.privacy ?? null);
  setStories(stories.stories ?? []);
}

export async function loadSettingsData(
  api: WebApiClient,
  session: SessionState,
  setSessionInfo: React.Dispatch<React.SetStateAction<AuthSessionResponse | null>>,
  setDeviceList: React.Dispatch<React.SetStateAction<DeviceListResponse | null>>,
  setSecurityEvents: React.Dispatch<React.SetStateAction<SecurityEventsResponse["events"]>>,
) {
  const [sessionInfo, deviceList, security] = await Promise.all([
    api.webSession(session.accessToken).catch(() => null),
    api.listDevices(session.accessToken).catch(() => null),
    api.listSecurityEvents(session.accessToken, 20).catch(() => ({ events: [] })),
  ]);
  setSessionInfo(sessionInfo);
  setDeviceList(deviceList);
  setSecurityEvents(security.events);
}

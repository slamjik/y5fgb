import { create } from "zustand";
import { persist } from "zustand/middleware";

import { randomID } from "@/lib/randomId";

export interface FriendContact {
  id: string;
  accountId: string;
  nickname: string;
  avatarColor: string;
  note: string;
  createdAt: string;
}

interface SocialStore {
  profile: {
    displayName: string;
    avatarColor: string;
    bio: string;
  };
  friends: FriendContact[];
  updateProfile: (patch: Partial<SocialStore["profile"]>) => void;
  addFriend: (payload: {
    accountId: string;
    nickname?: string;
    avatarColor?: string;
    note?: string;
  }) => void;
  removeFriend: (id: string) => void;
}

export const useSocialStore = create<SocialStore>()(
  persist(
    (set) => ({
      profile: {
        displayName: "",
        avatarColor: "#3fa5ff",
        bio: "",
      },
      friends: [],
      updateProfile: (patch) =>
        set((state) => ({
          profile: {
            ...state.profile,
            ...patch,
          },
        })),
      addFriend: (payload) =>
        set((state) => {
          const accountId = payload.accountId.trim();
          if (!accountId) {
            return state;
          }

          const existing = state.friends.find((friend) => friend.accountId === accountId);
          if (existing) {
            return {
              friends: state.friends.map((friend) =>
                friend.accountId === accountId
                  ? {
                      ...friend,
                      nickname: payload.nickname?.trim() || friend.nickname,
                      avatarColor: payload.avatarColor || friend.avatarColor,
                      note: payload.note?.trim() || friend.note,
                    }
                  : friend,
              ),
            };
          }

          const friend: FriendContact = {
            id: randomID(),
            accountId,
            nickname: payload.nickname?.trim() || accountId.slice(0, 8),
            avatarColor: payload.avatarColor || "#5e9bff",
            note: payload.note?.trim() || "",
            createdAt: new Date().toISOString(),
          };
          return { friends: [friend, ...state.friends] };
        }),
      removeFriend: (id) =>
        set((state) => ({
          friends: state.friends.filter((friend) => friend.id !== id),
        })),
    }),
    {
      name: "secure-messenger-social",
      partialize: (state) => ({
        profile: state.profile,
        friends: state.friends,
      }),
    },
  ),
);

import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { messagingRuntime } from "@/services/messaging/runtime";
import { useAuthStore } from "@/state/authStore";
import { useSocialStore } from "@/state/socialStore";

export function FriendsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const profile = useSocialStore((state) => state.profile);
  const friends = useSocialStore((state) => state.friends);
  const addFriend = useSocialStore((state) => state.addFriend);
  const removeFriend = useSocialStore((state) => state.removeFriend);

  const [accountId, setAccountId] = useState("");
  const [nickname, setNickname] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyFriendId, setBusyFriendId] = useState<string | null>(null);

  async function onCreateDirect(friendAccountId: string, friendId: string) {
    setBusyFriendId(friendId);
    setError(null);
    try {
      const conversation = await messagingRuntime.createDirect(friendAccountId);
      navigate(`/conversations/${conversation.id}`);
    } catch (createError) {
      setError(extractApiErrorMessage(createError));
    } finally {
      setBusyFriendId(null);
    }
  }

  function handleAddFriend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!accountId.trim()) {
      return;
    }
    addFriend({
      accountId,
      nickname,
      note,
    });
    setAccountId("");
    setNickname("");
    setNote("");
  }

  const profileLabel = profile.displayName.trim() || session?.email || t("friends.profileFallback");

  return (
    <section className="page-stack">
      <h1>{t("friends.title")}</h1>
      <p className="text-muted">{t("friends.subtitle")}</p>

      <div className="card-grid">
        <article className="card">
          <h2>{t("friends.myProfile")}</h2>
          <div className="friend-row">
            <div className="avatar-badge" style={{ backgroundColor: profile.avatarColor }} aria-hidden="true">
              {profileLabel.trim().slice(0, 2).toUpperCase()}
            </div>
            <div className="friend-meta">
              <p>
                <strong>{profileLabel}</strong>
              </p>
              <p className="text-muted">{session?.accountId ?? "-"}</p>
              {profile.bio ? <p className="text-muted">{profile.bio}</p> : null}
            </div>
          </div>
        </article>

        <article className="card">
          <h2>{t("friends.addFriend")}</h2>
          <form className="form-grid" onSubmit={handleAddFriend}>
            <label>
              {t("friends.accountId")}
              <input value={accountId} onChange={(event) => setAccountId(event.target.value)} required placeholder="uuid" />
            </label>
            <label>
              {t("friends.nickname")}
              <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder={t("friends.nicknamePlaceholder")} />
            </label>
            <label>
              {t("friends.note")}
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("friends.notePlaceholder")} />
            </label>
            <button type="submit">{t("friends.saveFriend")}</button>
          </form>
        </article>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="page-stack section-offset-sm">
        <h2>{t("friends.listTitle")}</h2>
        {friends.length === 0 ? <p className="state-message">{t("friends.empty")}</p> : null}
        <div className="card-grid">
          {friends.map((friend) => (
            <article className="card" key={friend.id}>
              <div className="friend-row">
                <div className="avatar-badge" style={{ backgroundColor: friend.avatarColor }} aria-hidden="true">
                  {friend.nickname.trim().slice(0, 2).toUpperCase()}
                </div>
                <div className="friend-meta">
                  <p>
                    <strong>{friend.nickname}</strong>
                  </p>
                  <p className="text-muted">{friend.accountId}</p>
                  {friend.note ? <p className="text-muted">{friend.note}</p> : null}
                </div>
              </div>
              <div className="inline-actions section-offset-sm">
                <button type="button" disabled={busyFriendId === friend.id} onClick={() => void onCreateDirect(friend.accountId, friend.id)}>
                  {busyFriendId === friend.id ? t("common.loading") : t("friends.startChat")}
                </button>
                <button type="button" onClick={() => removeFriend(friend.id)}>
                  {t("friends.remove")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

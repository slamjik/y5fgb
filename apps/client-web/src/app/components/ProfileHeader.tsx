import type { ProfileDTO } from "@project/protocol";
import React from "react";

interface ProfileHeaderProps {
  profile: ProfileDTO | null;
  banner: React.ReactNode;
  avatar: React.ReactNode;
  actions?: React.ReactNode;
}

export function ProfileHeader({ profile, banner, avatar, actions }: ProfileHeaderProps) {
  return (
    <section
      className="rounded-2xl border overflow-hidden interactive-surface app-section-transition"
      style={{
        backgroundColor: "var(--glass-fill-base)",
        borderColor: "var(--glass-border)",
      }}
    >
      <div className="h-36 border-b relative overflow-hidden" style={{ borderColor: "var(--glass-border)" }}>
        {banner}
      </div>
      <div className="p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-16 h-16 rounded-full border overflow-hidden shrink-0"
              style={{ borderColor: "var(--glass-border)", backgroundColor: "rgba(8,8,8,0.45)" }}
            >
              {avatar}
            </div>
            <div className="min-w-0">
              <p className="truncate" style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 700 }}>
                {profile?.displayName || "Профиль"}
              </p>
              <p className="truncate" style={{ color: "var(--base-grey-light)" }}>@{profile?.username || "username"}</p>
              {profile?.statusText ? (
                <p style={{ color: "var(--base-grey-light)", marginTop: 8 }}>{profile.statusText}</p>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex gap-2 flex-wrap sm:justify-end">{actions}</div> : null}
        </div>

        {profile?.bio ? (
          <p style={{ color: "var(--text-primary)" }}>{profile.bio}</p>
        ) : (
          <p style={{ color: "var(--base-grey-light)" }}>
            {profile ? "Пока нет описания профиля." : "Профиль загружается..."}
          </p>
        )}
      </div>
    </section>
  );
}

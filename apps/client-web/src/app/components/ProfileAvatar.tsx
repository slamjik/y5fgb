import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

interface ProfileAvatarProps {
  displayName: string;
  avatarUrl?: string | null;
  avatarColor: string;
  size?: number;
}

export function ProfileAvatar({
  displayName,
  avatarUrl,
  avatarColor,
  size = 72,
}: ProfileAvatarProps) {
  const initials = getInitials(displayName);

  return (
    <Avatar className="rounded-full border" style={{ width: size, height: size, borderColor: "var(--glass-border)" }}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName || "Профиль"} /> : null}
      <AvatarFallback
        style={{
          backgroundColor: avatarColor,
          color: "#111111",
          fontSize: Math.max(18, Math.round(size * 0.28)),
          fontWeight: 700,
        }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

function getInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "U";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}


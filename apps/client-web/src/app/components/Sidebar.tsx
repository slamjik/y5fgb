import { Bell, Compass, MessageSquare, Newspaper, Settings, User } from "lucide-react";
import * as React from "react";

export type SidebarSection = "messages" | "feed" | "explore" | "notifications" | "profile" | "settings";

interface SidebarProps {
  activeSection: SidebarSection;
  onChange: (section: SidebarSection) => void;
  badges?: Partial<Record<SidebarSection, number>>;
}

export function Sidebar({ activeSection, onChange, badges }: SidebarProps) {
  const navItems: Array<{
    id: SidebarSection;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
  }> = [
    { id: "messages", icon: MessageSquare, label: "Сообщения" },
    { id: "feed", icon: Newspaper, label: "Лента" },
    { id: "explore", icon: Compass, label: "Обзор" },
    { id: "notifications", icon: Bell, label: "Уведомления" },
    { id: "profile", icon: User, label: "Профиль" },
    { id: "settings", icon: Settings, label: "Настройки" },
  ];

  return (
    <div
      className="rounded-2xl p-5 border h-fit sticky top-6"
      style={{
        backgroundColor: "var(--glass-fill-base)",
        borderColor: "var(--glass-border)",
        backdropFilter: "blur(20px)",
      }}
    >
      <div className="space-y-2">
        {navItems.map((item) => (
          <NavItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={activeSection === item.id}
            badge={badges?.[item.id]}
            onClick={() => onChange(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <button
      type="button"
      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all"
      style={{
        backgroundColor: active || isHovered ? "var(--glass-fill-hover)" : "transparent",
        color: active ? "var(--accent-brown)" : "var(--base-grey-light)",
      }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Icon className="w-5 h-5" />
      <span className="flex-1 text-left">{label}</span>
      {typeof badge === "number" && badge > 0 ? (
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: "var(--accent-brown)",
            color: "var(--core-background)",
          }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

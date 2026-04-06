import { Bell, Compass, Home, Mail, Settings, User } from "lucide-react";
import * as React from "react";

export type SidebarSection = "home" | "explore" | "notifications" | "messages" | "profile" | "settings";

interface SidebarProps {
  activeSection: SidebarSection;
  onChange: (section: SidebarSection) => void;
}

export function Sidebar({ activeSection, onChange }: SidebarProps) {
  const navItems: Array<{
    id: SidebarSection;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
  }> = [
    { id: "home", icon: Home, label: "Главная" },
    { id: "explore", icon: Compass, label: "Обзор" },
    { id: "notifications", icon: Bell, label: "Уведомления" },
    { id: "messages", icon: Mail, label: "Сообщения" },
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
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
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
      <span>{label}</span>
    </button>
  );
}

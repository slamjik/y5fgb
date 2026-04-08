import { Bell, Compass, MessageSquare, Newspaper, Settings, User } from "lucide-react";
import * as React from "react";

import type { SidebarSection } from "./Sidebar";

type BottomNavProps = {
  activeSection: SidebarSection;
  onChange: (section: SidebarSection) => void;
  badges?: Partial<Record<SidebarSection, number>>;
};

const items: Array<{
  id: SidebarSection;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}> = [
  { id: "messages", icon: MessageSquare, label: "Чаты" },
  { id: "feed", icon: Newspaper, label: "Лента" },
  { id: "explore", icon: Compass, label: "Поиск" },
  { id: "notifications", icon: Bell, label: "Увед" },
  { id: "profile", icon: User, label: "Профиль" },
  { id: "settings", icon: Settings, label: "Настр" },
];

export function BottomNav({ activeSection, onChange, badges }: BottomNavProps) {
  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t px-2 py-2 backdrop-blur-xl"
      style={{
        backgroundColor: "rgba(17, 17, 17, 0.9)",
        borderColor: "var(--glass-border)",
        paddingBottom: "max(8px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="grid grid-cols-6 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeSection;
          const badge = badges?.[item.id] ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`bottom-nav-${item.id}`}
              className="relative rounded-lg py-2 px-1 text-center"
              style={{
                color: active ? "var(--accent-brown)" : "var(--base-grey-light)",
                backgroundColor: active ? "rgba(120,120,120,0.12)" : "transparent",
              }}
              onClick={() => onChange(item.id)}
            >
              <Icon className="w-4 h-4 mx-auto" />
              <span className="block text-[10px] mt-1 leading-none">{item.label}</span>
              {badge > 0 ? (
                <span
                  data-testid={`bottom-nav-${item.id}-badge`}
                  className="absolute top-1 right-1 text-[10px] px-1 rounded-full"
                  style={{
                    backgroundColor: "var(--accent-brown)",
                    color: "var(--core-background)",
                    minWidth: 16,
                  }}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

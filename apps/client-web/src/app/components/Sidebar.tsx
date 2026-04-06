import { Home, Compass, Bell, Mail, User, Settings } from 'lucide-react';
import { useState } from 'react';

export function Sidebar() {
  const [activeItem, setActiveItem] = useState('home');
  
  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'explore', icon: Compass, label: 'Explore' },
    { id: 'notifications', icon: Bell, label: 'Notifications' },
    { id: 'messages', icon: Mail, label: 'Messages' },
    { id: 'profile', icon: User, label: 'Profile' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];
  
  return (
    <div 
      className="rounded-2xl p-5 border h-fit sticky top-6"
      style={{
        backgroundColor: 'var(--glass-fill-base)',
        borderColor: 'var(--glass-border)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="space-y-2">
        {navItems.map((item) => (
          <NavItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={activeItem === item.id}
            onClick={() => setActiveItem(item.id)}
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
  onClick 
}: { 
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all"
      style={{
        backgroundColor: active || isHovered ? 'var(--glass-fill-hover)' : 'transparent',
        color: active ? 'var(--accent-brown)' : 'var(--base-grey-light)',
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

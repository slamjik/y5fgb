import { Image, Video, Smile } from 'lucide-react';
import { useState } from 'react';

export function CreatePost() {
  const [postText, setPostText] = useState('');
  
  return (
    <div 
      className="rounded-2xl p-5 border transition-all"
      style={{
        backgroundColor: 'var(--glass-fill-base)',
        borderColor: 'var(--glass-border)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <textarea
        value={postText}
        onChange={(e) => setPostText(e.target.value)}
        placeholder="What's on your mind?"
        className="w-full bg-transparent rounded-lg px-4 py-3 resize-none outline-none transition-colors border"
        style={{
          borderColor: 'var(--base-grey-light)',
          color: 'var(--text-primary)',
        }}
        rows={3}
        onFocus={(e) => {
          e.target.style.borderColor = 'var(--accent-brown)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'var(--base-grey-light)';
        }}
      />
      
      <div className="flex gap-3 mt-4">
        <MediaButton icon={<Image className="w-5 h-5" />} label="Photo" />
        <MediaButton icon={<Video className="w-5 h-5" />} label="Video" />
        <MediaButton icon={<Smile className="w-5 h-5" />} label="Mood" />
      </div>
    </div>
  );
}

function MediaButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <button
      className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all"
      style={{
        backgroundColor: isHovered ? 'var(--glass-fill-hover)' : 'transparent',
        backdropFilter: 'blur(10px)',
        color: isHovered ? 'var(--accent-brown)' : 'var(--base-grey-light)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {icon}
      <span style={{ color: 'var(--accent-brown)' }}>{label}</span>
    </button>
  );
}

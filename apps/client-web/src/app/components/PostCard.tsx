import { Heart, MessageCircle, Share2, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

interface PostCardProps {
  username: string;
  timestamp: string;
  imageUrl: string;
  caption: string;
  likes: number;
  comments: number;
}

export function PostCard({ username, timestamp, imageUrl, caption, likes, comments }: PostCardProps) {
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(likes);
  
  const handleLike = () => {
    setIsLiked(!isLiked);
    setLikeCount(isLiked ? likeCount - 1 : likeCount + 1);
  };
  
  const renderCaption = (text: string) => {
    const parts = text.split(/(#\w+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <span key={index} style={{ color: 'var(--accent-brown)' }}>
            {part}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };
  
  return (
    <div 
      className="rounded-2xl p-5 border transition-all"
      style={{
        backgroundColor: 'var(--glass-fill-base)',
        borderColor: 'var(--glass-border)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div 
            className="w-10 h-10 rounded-full"
            style={{ 
              background: 'linear-gradient(135deg, var(--accent-brown), var(--base-grey-light))'
            }}
          />
          <div>
            <div style={{ color: 'var(--accent-brown)' }}>{username}</div>
            <div className="text-xs" style={{ color: 'var(--base-grey-light)' }}>
              {timestamp}
            </div>
          </div>
        </div>
        <button 
          className="p-2 rounded-lg hover:bg-opacity-60 transition-colors"
          style={{ color: 'var(--base-grey-light)' }}
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>
      
      {/* Image */}
      <div 
        className="rounded-lg overflow-hidden mb-4"
        style={{ 
          padding: '8px',
          backgroundColor: 'rgba(0, 0, 0, 0.3)'
        }}
      >
        <img 
          src={imageUrl} 
          alt="Post content" 
          className="w-full h-80 object-cover rounded-lg"
        />
      </div>
      
      {/* Caption */}
      <p className="mb-4" style={{ color: 'var(--text-primary)' }}>
        {renderCaption(caption)}
      </p>
      
      {/* Interaction Bar */}
      <div className="flex items-center gap-6">
        <InteractionButton 
          icon={<Heart className="w-5 h-5" fill={isLiked ? 'var(--accent-brown)' : 'none'} />}
          count={likeCount}
          onClick={handleLike}
          active={isLiked}
        />
        <InteractionButton 
          icon={<MessageCircle className="w-5 h-5" />}
          count={comments}
        />
        <InteractionButton 
          icon={<Share2 className="w-5 h-5" />}
        />
      </div>
    </div>
  );
}

function InteractionButton({ 
  icon, 
  count, 
  onClick,
  active 
}: { 
  icon: React.ReactNode; 
  count?: number;
  onClick?: () => void;
  active?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <button
      className="flex items-center gap-2 transition-colors"
      style={{ 
        color: active ? 'var(--accent-brown)' : isHovered ? 'var(--accent-brown)' : 'var(--base-grey-light)'
      }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {icon}
      {count !== undefined && (
        <span className="text-xs" style={{ color: 'var(--base-grey-light)' }}>
          {count}
        </span>
      )}
    </button>
  );
}

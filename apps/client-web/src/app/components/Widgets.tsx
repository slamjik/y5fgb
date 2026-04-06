import { TrendingUp } from 'lucide-react';

export function Widgets() {
  const trends = [
    { tag: '#DesignInspiration', posts: '12.5K' },
    { tag: '#Photography', posts: '8.2K' },
    { tag: '#TravelDiaries', posts: '6.8K' },
    { tag: '#FoodieLife', posts: '5.4K' },
    { tag: '#TechNews', posts: '4.9K' },
  ];
  
  const suggestedUsers = [
    { name: 'Sarah Chen', handle: '@sarahchen', mutualFriends: 12 },
    { name: 'Alex Rivera', handle: '@arivera', mutualFriends: 8 },
    { name: 'Maya Patel', handle: '@mayap', mutualFriends: 5 },
  ];
  
  return (
    <div className="space-y-6 sticky top-6">
      {/* Trending Widget */}
      <div 
        className="rounded-2xl p-5 border"
        style={{
          backgroundColor: 'var(--glass-fill-base)',
          borderColor: 'var(--glass-border)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5" style={{ color: 'var(--accent-brown)' }} />
          <h3 style={{ color: 'var(--text-primary)' }}>Trending Now</h3>
        </div>
        
        <div className="space-y-3">
          {trends.map((trend, index) => (
            <TrendItem key={index} tag={trend.tag} posts={trend.posts} />
          ))}
        </div>
      </div>
      
      {/* Suggested Users Widget */}
      <div 
        className="rounded-2xl p-5 border"
        style={{
          backgroundColor: 'var(--glass-fill-base)',
          borderColor: 'var(--glass-border)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <h3 className="mb-4" style={{ color: 'var(--text-primary)' }}>Who to Follow</h3>
        
        <div className="space-y-4">
          {suggestedUsers.map((user, index) => (
            <SuggestedUser key={index} {...user} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TrendItem({ tag, posts }: { tag: string; posts: string }) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <button
      className="w-full text-left px-3 py-2 rounded-lg transition-all"
      style={{
        backgroundColor: isHovered ? 'var(--glass-fill-hover)' : 'transparent',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{ color: 'var(--accent-brown)' }}>{tag}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--base-grey-light)' }}>
        {posts} posts
      </div>
    </button>
  );
}

function SuggestedUser({ name, handle, mutualFriends }: { name: string; handle: string; mutualFriends: number }) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div 
          className="w-10 h-10 rounded-full"
          style={{ 
            background: 'linear-gradient(135deg, var(--accent-brown), var(--base-grey-light))'
          }}
        />
        <div>
          <div style={{ color: 'var(--text-primary)' }}>{name}</div>
          <div className="text-xs" style={{ color: 'var(--base-grey-light)' }}>
            {handle}
          </div>
        </div>
      </div>
      <button
        className="px-4 py-1.5 rounded-lg text-sm transition-all"
        style={{
          backgroundColor: isHovered ? 'var(--accent-brown)' : 'transparent',
          borderWidth: '1px',
          borderColor: 'var(--accent-brown)',
          color: isHovered ? 'var(--core-background)' : 'var(--accent-brown)',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        Follow
      </button>
    </div>
  );
}

import { useState } from 'react';

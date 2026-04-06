import { CreatePost } from './components/CreatePost';
import { PostCard } from './components/PostCard';
import { Sidebar } from './components/Sidebar';
import { Widgets } from './components/Widgets';

function App() {
  const posts = [
    {
      username: '@alexwanderer',
      timestamp: '2 hours ago',
      imageUrl: 'https://images.unsplash.com/photo-1635351261340-55f437000b21?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3VudGFpbiUyMGxhbmRzY2FwZSUyMHN1bnNldHxlbnwxfHx8fDE3NzUwOTIyMDF8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      caption: 'Chasing golden hour in the mountains 🏔️ #Photography #NatureLovers #TravelDiaries',
      likes: 342,
      comments: 28,
    },
    {
      username: '@urbanexplorer',
      timestamp: '5 hours ago',
      imageUrl: 'https://images.unsplash.com/photo-1618852432867-f98fa0616cbb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx1cmJhbiUyMHN0cmVldCUyMHBob3RvZ3JhcGh5JTIwbmlnaHR8ZW58MXx8fHwxNzc1MDUzNDg3fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      caption: 'City nights hit different ✨ #UrbanPhotography #NightVibes #StreetArt',
      likes: 518,
      comments: 45,
    },
    {
      username: '@coffeenclicks',
      timestamp: '8 hours ago',
      imageUrl: 'https://images.unsplash.com/photo-1722851176289-8468aace23b7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBhZXN0aGV0aWMlMjBtaW5pbWFsfGVufDF8fHx8MTc3NTEzNjc2MHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      caption: 'Morning ritual ☕ Simple moments, pure bliss. #CoffeeLover #MinimalAesthetic #MorningVibes',
      likes: 276,
      comments: 19,
    },
    {
      username: '@beachvibes',
      timestamp: '12 hours ago',
      imageUrl: 'https://images.unsplash.com/photo-1672841828482-45faa4c70e50?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0cm9waWNhbCUyMGJlYWNoJTIwc3Vuc2V0fGVufDF8fHx8MTc3NTEzMTM3NHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      caption: 'Paradise found 🌴🌊 Living for these sunset views! #BeachLife #TropicalVibes #SunsetChaser',
      likes: 891,
      comments: 67,
    },
  ];

  return (
    <div 
      className="min-h-screen"
      style={{ backgroundColor: 'var(--core-background)' }}
    >
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="grid grid-cols-[280px_1fr_320px] gap-6">
          {/* Left Sidebar - Navigation */}
          <div>
            <Sidebar />
          </div>
          
          {/* Center - Feed */}
          <div className="space-y-6">
            <CreatePost />
            
            {posts.map((post, index) => (
              <PostCard key={index} {...post} />
            ))}
          </div>
          
          {/* Right Sidebar - Widgets */}
          <div>
            <Widgets />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

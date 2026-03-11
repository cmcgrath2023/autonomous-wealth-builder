'use client';

import ActivityFeed from '../../components/ag-ui/ActivityFeed';

export default function ActivityPage() {
  return (
    <div className="flex flex-col w-full h-full min-h-screen p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold text-white/90">Agent Activity</h1>
        <p className="text-sm text-white/40 mt-1">
          AG-UI Protocol — Real-time agent visibility
        </p>
      </div>
      <ActivityFeed />
    </div>
  );
}

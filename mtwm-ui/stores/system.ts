import { create } from 'zustand';
import { SwarmStatus } from '@/lib/ruflow';

interface SystemStore {
  swarmStatus: SwarmStatus | null;
  connected: { ruvector: boolean; ruflow: boolean; claude: boolean };
  fetchSystemStatus: () => Promise<void>;
}

export const useSystemStore = create<SystemStore>((set) => ({
  swarmStatus: null,
  connected: { ruvector: false, ruflow: false, claude: false },

  fetchSystemStatus: async () => {
    try {
      const response = await fetch('/api/system/status');
      const data = await response.json();
      set({ swarmStatus: data.swarm, connected: data.connected });
    } catch {
      set({ connected: { ruvector: false, ruflow: false, claude: false } });
    }
  },
}));

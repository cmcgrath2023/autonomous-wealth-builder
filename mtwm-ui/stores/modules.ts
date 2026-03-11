import { create } from 'zustand';
import { ModuleStatus } from '@/types/modules';

interface ModulesStore {
  modules: ModuleStatus[];
  fetchModules: () => Promise<void>;
}

export const useModulesStore = create<ModulesStore>((set) => ({
  modules: [],

  fetchModules: async () => {
    try {
      const response = await fetch('/api/modules');
      const data = await response.json();
      set({ modules: data.modules });
    } catch {
      console.error('Failed to fetch modules');
    }
  },
}));

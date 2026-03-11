import { create } from 'zustand';
import { Decision } from '@/types/decisions';

interface DecisionsStore {
  decisions: Decision[];
  fetchDecisions: () => Promise<void>;
  approveDecision: (id: string) => Promise<void>;
  rejectDecision: (id: string) => Promise<void>;
}

export const useDecisionsStore = create<DecisionsStore>((set, get) => ({
  decisions: [],

  fetchDecisions: async () => {
    try {
      const response = await fetch('/api/decisions');
      if (!response.ok) return;
      const data = await response.json();
      set({ decisions: data.decisions || [] });
    } catch {
      // Silently fail — likely auth redirect or gateway down
    }
  },

  approveDecision: async (id: string) => {
    await fetch(`/api/decisions/${id}/approve`, { method: 'POST' });
    set({ decisions: get().decisions.map((d) => (d.id === id ? { ...d, status: 'approved' as const } : d)) });
  },

  rejectDecision: async (id: string) => {
    await fetch(`/api/decisions/${id}/reject`, { method: 'POST' });
    set({ decisions: get().decisions.map((d) => (d.id === id ? { ...d, status: 'rejected' as const } : d)) });
  },
}));

import { create } from 'zustand';
import type { UserRole } from '@wf/shared';

interface UiState {
  selectedDocId: string | null;
  role: UserRole;
  select: (id: string) => void;
  setRole: (role: UserRole) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedDocId: null,
  role: 'REVIEWER',
  select: (id) => set({ selectedDocId: id }),
  setRole: (role) => set({ role }),
}));

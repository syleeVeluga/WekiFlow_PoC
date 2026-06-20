import { create } from 'zustand';

export type ActivePage = 'home' | 'review' | 'kb' | 'doc' | 'map' | 'ask' | 'conversation' | 'sources' | 'rules' | 'history' | 'add' | 'users' | 'agent' | 'trash' | 'dev';

export interface TreeContextMenu {
  x: number;
  y: number;
  kind: 'page' | 'category';
  id: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  subtitle: string;
}

const DEFAULT_WORKSPACE: Workspace = {
  id: 'workspace-default',
  name: '총무팀',
  subtitle: '운영 워크스페이스',
};

interface UiState {
  activePage: ActivePage;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  selectedDocId: string | null;
  selectedCategory: string | null;
  treeOpen: Record<string, boolean>;
  treeSearch: string;
  kb: {
    mode: 'grid' | 'cat';
    personF: string;
    topicF: string;
    tagF: string | null;
    statusF: string;
    query: string;
    sort: 'uses' | 'recent' | 'alpha';
  };
  review: {
    tab: 'new';
    rvDone: Record<string, boolean>;
    detailPanelItemId: string | null;
  };
  docTab: 'edit' | 'source' | 'relations' | 'history';
  modal: { aiTags: boolean; catManager: boolean };
  contextMenu: TreeContextMenu | null;
  toast: { msg: string; type: 'ok' | 'warn' | 'inf' } | null;
  go: (page: ActivePage) => void;
  createWorkspace: (name: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  selectWorkspace: (id: string) => void;
  openDoc: (id: string, category?: string) => void;
  openCategory: (name: string) => void;
  toggleTree: (id: string) => void;
  setTreeSearch: (value: string) => void;
  setKb: (patch: Partial<UiState['kb']>) => void;
  setReviewTab: (tab: UiState['review']['tab']) => void;
  setReviewDetail: (id: string | null) => void;
  markReviewDone: (id: string) => void;
  setDocTab: (tab: UiState['docTab']) => void;
  setModal: (patch: Partial<UiState['modal']>) => void;
  openContextMenu: (menu: TreeContextMenu) => void;
  closeContextMenu: () => void;
  showToast: (msg: string, type?: 'ok' | 'warn' | 'inf') => void;
  clearToast: () => void;
  select: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activePage: 'home',
  workspaces: [DEFAULT_WORKSPACE],
  activeWorkspaceId: DEFAULT_WORKSPACE.id,
  selectedDocId: null,
  selectedCategory: null,
  treeOpen: {},
  treeSearch: '',
  kb: { mode: 'grid', personF: 'all', topicF: 'all', tagF: null, statusF: 'all', query: '', sort: 'uses' },
  review: { tab: 'new', rvDone: {}, detailPanelItemId: null },
  docTab: 'edit',
  modal: { aiTags: false, catManager: false },
  contextMenu: null,
  toast: null,
  go: (activePage) => set({ activePage }),
  createWorkspace: (name) =>
    set((state) => {
      const trimmed = name.trim();
      if (!trimmed) return state;
      const workspace: Workspace = {
        id: `workspace-${Date.now()}`,
        name: trimmed,
        subtitle: '사용자 워크스페이스',
      };
      return { workspaces: [...state.workspaces, workspace], activeWorkspaceId: workspace.id };
    }),
  renameWorkspace: (id, name) =>
    set((state) => {
      const trimmed = name.trim();
      if (!trimmed) return state;
      return { workspaces: state.workspaces.map((workspace) => (workspace.id === id ? { ...workspace, name: trimmed } : workspace)) };
    }),
  deleteWorkspace: (id) =>
    set((state) => {
      if (state.workspaces.length <= 1) return state;
      const workspaces = state.workspaces.filter((workspace) => workspace.id !== id);
      return {
        workspaces,
        activeWorkspaceId: state.activeWorkspaceId === id ? workspaces[0]!.id : state.activeWorkspaceId,
      };
    }),
  selectWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
  openDoc: (id, category) =>
    set((state) => ({
      activePage: 'doc',
      selectedDocId: id,
      selectedCategory: category ?? null,
      treeOpen: category ? { ...state.treeOpen, [category]: true } : state.treeOpen,
      docTab: 'edit',
    })),
  openCategory: (name) =>
    set((state) => ({
      activePage: 'kb',
      selectedCategory: name,
      kb: { ...state.kb, mode: 'cat', topicF: name, tagF: null },
      treeOpen: { ...state.treeOpen, [name]: true },
    })),
  toggleTree: (id) => set((state) => ({ treeOpen: { ...state.treeOpen, [id]: !state.treeOpen[id] } })),
  setTreeSearch: (treeSearch) => set({ treeSearch }),
  setKb: (patch) => set((state) => ({ kb: { ...state.kb, ...patch } })),
  setReviewTab: (tab) => set((state) => ({ activePage: 'review', review: { ...state.review, tab } })),
  setReviewDetail: (id) => set((state) => ({ review: { ...state.review, detailPanelItemId: id } })),
  markReviewDone: (id) => set((state) => ({ review: { ...state.review, rvDone: { ...state.review.rvDone, [id]: true } } })),
  setDocTab: (docTab) => set({ docTab }),
  setModal: (patch) => set((state) => ({ modal: { ...state.modal, ...patch } })),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  showToast: (msg, type = 'inf') => set({ toast: { msg, type } }),
  clearToast: () => set({ toast: null }),
  select: (id) => set({ selectedDocId: id, selectedCategory: null, activePage: 'doc' }),
}));

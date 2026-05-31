import { create } from 'zustand';

export type ActivePage = 'home' | 'review' | 'kb' | 'doc' | 'sources' | 'rules' | 'history' | 'add' | 'users' | 'agent';

interface UiState {
  activePage: ActivePage;
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
  toast: { msg: string; type: 'ok' | 'warn' | 'inf' } | null;
  go: (page: ActivePage) => void;
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
  showToast: (msg: string, type?: 'ok' | 'warn' | 'inf') => void;
  clearToast: () => void;
  select: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activePage: 'home',
  selectedDocId: null,
  selectedCategory: null,
  treeOpen: {},
  treeSearch: '',
  kb: { mode: 'grid', personF: 'all', topicF: 'all', tagF: null, statusF: 'all', query: '', sort: 'uses' },
  review: { tab: 'new', rvDone: {}, detailPanelItemId: null },
  docTab: 'edit',
  modal: { aiTags: false, catManager: false },
  toast: null,
  go: (activePage) => set({ activePage }),
  openDoc: (id, category) =>
    set((state) => ({
      activePage: 'doc',
      selectedDocId: id,
      selectedCategory: category ?? state.selectedCategory,
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
  showToast: (msg, type = 'inf') => set({ toast: { msg, type } }),
  clearToast: () => set({ toast: null }),
  select: (id) => set({ selectedDocId: id, activePage: 'doc' }),
}));

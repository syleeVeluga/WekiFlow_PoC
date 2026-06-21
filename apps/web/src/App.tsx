import { useEffect, useState, type CSSProperties } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Lnb } from './components/lnb/Lnb.js';
import { HomePage } from './components/home/HomePage.js';
import { KbPage } from './components/kb/KbPage.js';
import { DocPage } from './components/doc/DocPage.js';
import { ReviewDetailPanel, ReviewPage } from './components/review/ReviewPage.js';
import { UsersPage } from './components/users/UsersPage.js';
import { AgentPreviewPage } from './components/agent/AgentPreviewPage.js';
import { ConversationPage } from './components/conversation/ConversationPage.js';
import { DevPanel } from './components/admin/DevPanel.js';
import { AddPage } from './components/add/AddPage.js';
import { TrashPage } from './components/trash/TrashPage.js';
import { KnowledgeMapPage } from './components/map/KnowledgeMapPage.js';
import { AskPage } from './components/ask/AskPage.js';
import { ActivityPage } from './components/history/ActivityPage.js';
import { LoginPage } from './components/auth/LoginPage.js';
import { Toast } from './components/common/Primitives.js';
import { fetchMe, setAuthToken } from './api/client.js';
import { getStoredToken, useAuthStore } from './auth/store.js';
import { useUiStore } from './store.js';

const queryClient = new QueryClient();

function ActivePage() {
  const activePage = useUiStore((state) => state.activePage);
  if (activePage === 'home') return <HomePage />;
  if (activePage === 'review') return <ReviewPage />;
  if (activePage === 'kb') return <KbPage />;
  if (activePage === 'doc') return <DocPage />;
  if (activePage === 'map') return <KnowledgeMapPage />;
  if (activePage === 'ask') return <AskPage />;
  if (activePage === 'users') return <UsersPage />;
  if (activePage === 'agent') return <AgentPreviewPage />;
  if (activePage === 'conversation') return <ConversationPage />;
  if (activePage === 'dev') return <DevPanel />;
  if (activePage === 'trash') return <TrashPage />;
  if (activePage === 'history') return <ActivityPage />;
  return <AddPage />;
}

function Workspace() {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('wf.sidebarWidth'));
    return Number.isFinite(stored) && stored >= 220 && stored <= 420 ? stored : 256;
  });

  const beginResize = () => {
    const onMove = (event: PointerEvent) => {
      const next = Math.min(420, Math.max(220, event.clientX));
      setSidebarWidth(next);
      localStorage.setItem('wf.sidebarWidth', String(next));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-resizing-sidebar');
    };
    document.body.classList.add('is-resizing-sidebar');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="app" style={{ '--sw': `${sidebarWidth}px` } as CSSProperties}>
      <Lnb />
      <div
        aria-label="사이드바 너비 조절"
        className="layout-resizer"
        onDoubleClick={() => {
          setSidebarWidth(256);
          localStorage.setItem('wf.sidebarWidth', String(256));
        }}
        onPointerDown={beginResize}
        role="separator"
      />
      <main className="main">
        <ActivePage />
      </main>
      <ReviewDetailPanel />
      <Toast />
    </div>
  );
}

export function App() {
  const status = useAuthStore((s) => s.status);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  // Restore the persisted session on boot: re-attach the token, then validate via /auth/me.
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      clear();
      return;
    }
    setAuthToken(token);
    fetchMe()
      .then(setUser)
      .catch(() => clear());
  }, [clear, setUser]);

  return (
    <QueryClientProvider client={queryClient}>
      {status === 'loading' ? (
        <div className="login-shell">
          <div className="login-splash">불러오는 중…</div>
        </div>
      ) : status === 'authed' ? (
        <Workspace />
      ) : (
        <LoginPage />
      )}
    </QueryClientProvider>
  );
}

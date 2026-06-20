import { useEffect } from 'react';
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
import { LoginPage } from './components/auth/LoginPage.js';
import { Toast } from './components/common/Primitives.js';
import { fetchMe, setAuthToken } from './api/client.js';
import { getStoredToken, useAuthStore } from './auth/store.js';
import { useUiStore } from './store.js';

const queryClient = new QueryClient();

function StubPage({ title }: { title: string }) {
  return (
    <section className="page">
      <p className="eyebrow">WikiFlow</p>
      <h1>{title}</h1>
      <div className="empty">이 영역은 현재 Phase 범위 밖의 내비게이션 스텁입니다.</div>
    </section>
  );
}

function ActivePage() {
  const activePage = useUiStore((state) => state.activePage);
  if (activePage === 'home') return <HomePage />;
  if (activePage === 'review') return <ReviewPage />;
  if (activePage === 'kb') return <KbPage />;
  if (activePage === 'doc') return <DocPage />;
  if (activePage === 'map') return <KnowledgeMapPage />;
  if (activePage === 'users') return <UsersPage />;
  if (activePage === 'agent') return <AgentPreviewPage />;
  if (activePage === 'conversation') return <ConversationPage />;
  if (activePage === 'dev') return <DevPanel />;
  if (activePage === 'trash') return <TrashPage />;
  if (activePage === 'sources') return <StubPage title="데이터 소스" />;
  if (activePage === 'rules') return <StubPage title="자동화 규칙" />;
  if (activePage === 'history') return <StubPage title="변경 이력" />;
  return <AddPage />;
}

function Workspace() {
  return (
    <div className="app">
      <Lnb />
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

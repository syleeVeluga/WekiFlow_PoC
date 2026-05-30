import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Lnb } from './components/lnb/Lnb.js';
import { HomePage } from './components/home/HomePage.js';
import { KbPage } from './components/kb/KbPage.js';
import { DocPage } from './components/doc/DocPage.js';
import { ReviewDetailPanel, ReviewPage } from './components/review/ReviewPage.js';
import { Toast } from './components/common/Primitives.js';
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
  if (activePage === 'sources') return <StubPage title="데이터 소스" />;
  if (activePage === 'rules') return <StubPage title="자동화 규칙" />;
  if (activePage === 'history') return <StubPage title="변경 이력" />;
  return <StubPage title="직접 추가" />;
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
  return (
    <QueryClientProvider client={queryClient}>
      <Workspace />
    </QueryClientProvider>
  );
}

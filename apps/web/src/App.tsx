import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDocument, useTree } from './api/hooks.js';
import { DocumentTree } from './components/DocumentTree.js';
import { ReviewQueue } from './components/ReviewQueue.js';
import { KnowledgeBase } from './components/KnowledgeBase.js';
import { IngestForm } from './components/IngestForm.js';
import { HybridEditor } from './components/HybridEditor.js';
import { useUiStore } from './store.js';

const queryClient = new QueryClient();

function Workspace() {
  const { selectedDocId, select } = useUiStore();
  const { data: tree = [] } = useTree();
  const selectedDoc = useDocument(selectedDocId);

  return (
    <main className="shell">
      <aside className="sidebar">
        <DocumentTree nodes={tree} selectedId={selectedDocId} onSelect={select} />
        <ReviewQueue selectedId={selectedDocId} onSelect={select} />
        <KnowledgeBase selectedId={selectedDocId} onSelect={select} />
        <IngestForm onIngested={select} />
      </aside>
      <section className="workspace">
        {selectedDoc.data ? (
          <HybridEditor doc={selectedDoc.data} />
        ) : (
          <div className="empty-workspace">
            <p>좌측에서 문서를 선택하거나 ✏️ 직접 추가로 인입하세요.</p>
          </div>
        )}
      </section>
    </main>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Workspace />
    </QueryClientProvider>
  );
}

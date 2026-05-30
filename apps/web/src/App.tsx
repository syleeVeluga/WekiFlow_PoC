import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DocumentDTO } from '@wf/shared';
import { HybridEditor } from './components/HybridEditor.js';
import { DocumentTree } from './components/DocumentTree.js';

const queryClient = new QueryClient();

const sampleDoc: DocumentDTO = {
  id: 'doc-1',
  slug: 'hr/annual-leave-policy',
  title: '연차 휴가 규정',
  parentId: null,
  isFolder: false,
  status: 'REVIEW',
  contentMarkdown: '# 연차 휴가 규정\n\n기존 승인 문서입니다.',
  draftMarkdown: '# 연차 휴가 규정\n\n신입사원은 연차 15일을 부여받는다.',
  version: 1,
  sourceRefs: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <main className="shell">
        <aside className="sidebar">
          <DocumentTree
            nodes={[
              {
                id: sampleDoc.id,
                parentId: sampleDoc.parentId,
                title: sampleDoc.title,
                status: sampleDoc.status,
              },
            ]}
          />
        </aside>
        <section className="workspace">
          <HybridEditor doc={sampleDoc} />
        </section>
      </main>
    </QueryClientProvider>
  );
}

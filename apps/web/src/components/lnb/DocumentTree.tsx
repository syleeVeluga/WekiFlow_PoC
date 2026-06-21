import { useTree } from '../../api/hooks.js';
import { useTreeCategories } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { TreeCategory } from './TreeCategory.js';
import { TreeContextMenu } from './TreeContextMenu.js';

function sourceStatusLabel(status: string): string {
  if (status === 'DRAFT') return '지식화 안 됨';
  if (status === 'PROCESSING') return 'AI 처리 중';
  if (status === 'REVIEW') return '확인 필요';
  if (status === 'FAILED') return '처리 실패';
  return status;
}

// 미분류를 포함한 분류 목록은 서버(treeCategories → groupKnowledgeByCategory)가 항상 보장한다.
export function LnbDocumentTree() {
  const { data: categories = [] } = useTreeCategories();
  const { data: docs = [] } = useTree();
  const treeSearch = useUiStore((s) => s.treeSearch);
  const setTreeSearch = useUiStore((s) => s.setTreeSearch);
  const selectedDocId = useUiStore((s) => s.selectedDocId);
  const openDoc = useUiStore((s) => s.openDoc);
  const needle = treeSearch.trim().toLowerCase();
  const sourceDocs = docs
    .filter((doc) => doc.status !== 'PUBLISHED' && doc.status !== 'GRAPH_INDEXED')
    .filter((doc) => !needle || doc.title.toLowerCase().includes(needle) || doc.status.toLowerCase().includes(needle));
  const hasVisibleCategories = categories.length > 0;
  const hasSourceDocs = sourceDocs.length > 0;
  return (
    <>
      <input className="tree-search" value={treeSearch} placeholder="문서 검색" onChange={(e) => setTreeSearch(e.target.value)} />
      <div className="doc-tree">
        {!hasVisibleCategories && !hasSourceDocs ? (
          <div className="tree-empty">문서가 없습니다.</div>
        ) : (
          <>
            {hasVisibleCategories ? <div className="tree-sec-label">공식 지식</div> : null}
            {categories.map((category) => <TreeCategory key={category.id} category={category} />)}
            {hasSourceDocs ? (
              <div className="tree-cat">
                <div className="tree-cat-row tree-source-head">
                  <span className="tree-caret open">›</span>
                  <span className="cat-dot source" />
                  <strong>인입 원본</strong>
                  <span className="tree-count">{sourceDocs.length}</span>
                </div>
                <div className="tree-docs">
                  {sourceDocs.map((doc) => (
                    <button
                      type="button"
                      className={`tree-doc-row ${selectedDocId === doc.id ? 'on' : ''}`}
                      key={doc.id}
                      onClick={() => openDoc(doc.id)}
                    >
                      <span>▫</span>
                      <span>{doc.title}</span>
                      <small className="tree-status">{sourceStatusLabel(doc.status)}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      <TreeContextMenu />
    </>
  );
}

import type { DocumentStatus } from '@wf/shared';
import { useMemo } from 'react';
import { useTree } from '../../api/hooks.js';
import { buildTree, type TreeItem } from '../../lib/buildTree.js';
import { useUiStore } from '../../store.js';

const STATUS_TONE: Record<DocumentStatus, string> = {
  DRAFT: 'draft',
  PROCESSING: 'processing',
  PREVIEW: 'preview',
  REVIEW: 'review',
  PUBLISHED: 'published',
  GRAPH_INDEXED: 'indexed',
  FAILED: 'failed',
};

function TreeRows({ items, depth, selectedId, query, openDoc }: {
  items: TreeItem[];
  depth: number;
  selectedId: string | null;
  query: string;
  openDoc: (id: string) => void;
}) {
  return (
    <>
      {items.map((item) => {
        const matches = item.title.toLowerCase().includes(query);
        const childMatches = item.children.length > 0;
        if (query && !matches && !childMatches) return null;
        return (
          <div key={item.id}>
            <button
              type="button"
              className={`tree-doc-row layer1-row ${selectedId === item.id ? 'on' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => openDoc(item.id)}
            >
              <span className="tree-doc-title">{item.isFolder ? '▸' : '•'} {item.title}</span>
              <span className={`tree-status tree-status-${STATUS_TONE[item.status]}`}>{item.status}</span>
            </button>
            <TreeRows items={item.children} depth={depth + 1} selectedId={selectedId} query={query} openDoc={openDoc} />
          </div>
        );
      })}
    </>
  );
}

export function LnbDocumentTree() {
  const { data = [] } = useTree();
  const treeSearch = useUiStore((s) => s.treeSearch);
  const setTreeSearch = useUiStore((s) => s.setTreeSearch);
  const openDoc = useUiStore((s) => s.openDoc);
  const selectedId = useUiStore((s) => s.selectedDocId);
  const query = treeSearch.trim().toLowerCase();
  const tree = useMemo(() => buildTree(data), [data]);
  return (
    <>
      <input className="tree-search" value={treeSearch} placeholder="문서 검색" onChange={(e) => setTreeSearch(e.target.value)} />
      <div className="doc-tree">
        {tree.length === 0 ? (
          <div className="tree-empty">문서가 없습니다.</div>
        ) : (
          <TreeRows items={tree} depth={0} selectedId={selectedId} query={query} openDoc={openDoc} />
        )}
      </div>
    </>
  );
}

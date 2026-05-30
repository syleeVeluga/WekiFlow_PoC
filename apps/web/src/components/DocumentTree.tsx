import type { TreeNode } from '@wf/shared';
import { buildTree, type TreeItem } from '../lib/buildTree.js';

interface DocumentTreeProps {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function TreeRow({
  item,
  depth,
  selectedId,
  onSelect,
}: {
  item: TreeItem;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <button
        className={`tree-row${item.id === selectedId ? ' selected' : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        type="button"
        onClick={() => onSelect(item.id)}
      >
        <span>
          {item.isFolder ? '📁 ' : '📄 '}
          {item.title}
        </span>
        <span className="status">{item.status}</span>
      </button>
      {item.children.map((child) => (
        <TreeRow
          key={child.id}
          item={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function DocumentTree({ nodes, selectedId, onSelect }: DocumentTreeProps) {
  const tree = buildTree(nodes);
  return (
    <nav aria-label="문서 트리" className="tree">
      <div className="tree-title">📁 문서 트리</div>
      {tree.length === 0 ? (
        <p className="empty">문서가 없습니다.</p>
      ) : (
        tree.map((item) => (
          <TreeRow
            key={item.id}
            item={item}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))
      )}
    </nav>
  );
}

import type { DocumentStatus } from '@wf/shared';

export interface DocumentTreeNode {
  id: string;
  parentId: string | null;
  title: string;
  status: DocumentStatus;
}

export function DocumentTree({ nodes }: { nodes: DocumentTreeNode[] }) {
  return (
    <nav aria-label="문서 트리" className="tree">
      <div className="tree-title">문서 트리</div>
      {nodes.map((node) => (
        <button key={node.id} className="tree-row" type="button">
          <span>{node.title}</span>
          <span className="status">{node.status}</span>
        </button>
      ))}
    </nav>
  );
}

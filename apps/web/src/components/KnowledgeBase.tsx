import { usePublished } from '../api/hooks.js';

export function KnowledgeBase({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: published = [] } = usePublished();

  return (
    <nav aria-label="조직 지식" className="panel-list">
      <div className="tree-title">🔷 조직 지식 ({published.length})</div>
      {published.length === 0 ? (
        <p className="empty">배포된 문서가 없습니다.</p>
      ) : (
        published.map((doc) => (
          <button
            key={doc.id}
            className={`tree-row${doc.id === selectedId ? ' selected' : ''}`}
            type="button"
            onClick={() => onSelect(doc.id)}
          >
            <span>📘 {doc.title}</span>
            <span className="status">PUBLISHED</span>
          </button>
        ))
      )}
    </nav>
  );
}

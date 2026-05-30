import { useReviews } from '../api/hooks.js';

export function ReviewQueue({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: reviews = [], isLoading } = useReviews();

  return (
    <nav aria-label="검토 대기" className="panel-list">
      <div className="tree-title">🔴 검토 ({reviews.length})</div>
      {isLoading ? (
        <p className="empty">불러오는 중…</p>
      ) : reviews.length === 0 ? (
        <p className="empty">검토 대기 문서가 없습니다.</p>
      ) : (
        reviews.map((doc) => (
          <button
            key={doc.id}
            className={`tree-row${doc.id === selectedId ? ' selected' : ''}`}
            type="button"
            onClick={() => onSelect(doc.id)}
          >
            <span>📝 {doc.title}</span>
            <span className="status">REVIEW</span>
          </button>
        ))
      )}
    </nav>
  );
}

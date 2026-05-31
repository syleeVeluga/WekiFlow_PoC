import { canEdit } from '@wf/shared';
import { usePurgeTrash, useRestoreTrash, useTrash } from '../../api/hooks.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';

export function TrashPage() {
  const role = useAuthStore((s) => s.user?.role ?? 'VIEWER');
  const showToast = useUiStore((s) => s.showToast);
  const { data: items = [], isLoading } = useTrash();
  const restore = useRestoreTrash();
  const purge = usePurgeTrash();

  if (!canEdit(role)) {
    return (
      <section className="pg stub">
        <h1>접근 권한이 없습니다</h1>
        <p className="muted">휴지통은 편집 권한 이상만 이용할 수 있습니다.</p>
      </section>
    );
  }

  const onRestore = (id: string) => {
    restore.mutate(id, {
      onSuccess: () => showToast('복원했습니다.', 'ok'),
      onError: () => showToast('복원에 실패했습니다.', 'warn'),
    });
  };

  const onPurge = (id: string, title: string) => {
    if (!window.confirm(`'${title}'을(를) 완전히 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    purge.mutate(id, {
      onSuccess: () => showToast('완전히 삭제했습니다.', 'ok'),
      onError: () => showToast('삭제에 실패했습니다.', 'warn'),
    });
  };

  return (
    <section className="pg">
      <div className="topbar"><div><h1>휴지통</h1><p className="muted">삭제한 페이지를 복원하거나 완전히 삭제합니다.</p></div></div>
      <div className="card">
        {isLoading ? (
          <p className="muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="muted">휴지통이 비어 있습니다.</p>
        ) : (
          <ul className="trash-list">
            {items.map((item) => (
              <li className="trash-row" key={item.id}>
                <div className="trash-info">
                  <strong>{item.title}</strong>
                  <small>{item.category ? `${item.category} · ` : ''}{item.trashedAt}</small>
                </div>
                <div className="trash-actions">
                  <button type="button" className="btn" disabled={restore.isPending} onClick={() => onRestore(item.id)}>복원</button>
                  <button type="button" className="btn danger" disabled={purge.isPending} onClick={() => onPurge(item.id, item.title)}>완전 삭제</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

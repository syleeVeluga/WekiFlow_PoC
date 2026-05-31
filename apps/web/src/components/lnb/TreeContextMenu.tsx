import { useEffect } from 'react';
import { canEdit, UNCLASSIFIED_TOPIC_NAME } from '@wf/shared';
import { useTrashDocument } from '../../api/hooks.js';
import { useTopicMutations } from '../../data/hooks.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';

/**
 * Right-click menu for the document tree. Pages delete to the trash (soft delete); categories are
 * removed by reassigning their pages to 미분류. Both actions require 편집(EDITOR) 이상 권한.
 */
export function TreeContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);
  const showToast = useUiStore((s) => s.showToast);
  const role = useAuthStore((s) => s.user?.role ?? 'VIEWER');
  const trash = useTrashDocument();
  const { declassify } = useTopicMutations();

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, close]);

  if (!menu) return null;
  const allowed = canEdit(role);
  const isUnclassified = menu.kind === 'category' && menu.name === UNCLASSIFIED_TOPIC_NAME;

  const onDeletePage = () => {
    close();
    if (!window.confirm(`'${menu.name}' 페이지를 휴지통으로 이동할까요?`)) return;
    trash.mutate(menu.id, {
      onSuccess: () => showToast('휴지통으로 이동했습니다.', 'ok'),
      onError: () => showToast('삭제에 실패했습니다.', 'warn'),
    });
  };

  const onDeleteCategory = () => {
    close();
    if (!window.confirm(`'${menu.name}' 분류를 삭제할까요? 페이지는 미분류로 이동합니다.`)) return;
    declassify.mutate(menu.name, {
      onSuccess: () => showToast('분류를 삭제했습니다. 페이지는 미분류로 이동했습니다.', 'ok'),
      onError: () => showToast('분류 삭제에 실패했습니다.', 'warn'),
    });
  };

  return (
    <>
      <div
        className="ctx-backdrop"
        onClick={close}
        onContextMenu={(event) => {
          event.preventDefault();
          close();
        }}
      />
      <div className="ctx-menu" style={{ top: menu.y, left: menu.x }} role="menu">
        {menu.kind === 'page' ? (
          <button type="button" className="ctx-item danger" disabled={!allowed} onClick={onDeletePage}>
            🗑 삭제 (휴지통으로)
          </button>
        ) : (
          <button type="button" className="ctx-item danger" disabled={!allowed || isUnclassified} onClick={onDeleteCategory}>
            🗑 분류 삭제 (미분류로 이동)
          </button>
        )}
        {!allowed ? <div className="ctx-note">편집 권한이 필요합니다.</div> : null}
      </div>
    </>
  );
}

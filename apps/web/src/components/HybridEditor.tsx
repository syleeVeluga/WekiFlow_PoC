import { lazy, Suspense, useState } from 'react';
import type { DocumentDTO, UserRole } from '@wf/shared';
import { useApprove, useReject } from '../api/hooks.js';
import { useUiStore } from '../store.js';
import { ApiError } from '../api/client.js';
import { BlockNotePane } from './blocknote/BlockNotePane.js';

type ViewMode = 'read' | 'review';

const ROLES: UserRole[] = ['ADMIN', 'REVIEWER', 'EDITOR', 'VIEWER'];

const MonacoDiffPane = lazy(async () => {
  const module = await import('./monaco/MonacoDiffPane.js');
  return { default: module.MonacoDiffPane };
});

export function HybridEditor({ doc }: { doc: DocumentDTO }) {
  const [mode, setMode] = useState<ViewMode>(doc.status === 'REVIEW' ? 'review' : 'read');
  const { role, setRole } = useUiStore();
  const approve = useApprove();
  const reject = useReject();
  const [error, setError] = useState<string | null>(null);

  const isReview = doc.status === 'REVIEW';

  const onApprove = () => {
    setError(null);
    approve.mutate(
      { id: doc.id, role },
      {
        onError: (err) =>
          setError(err instanceof ApiError && err.status === 403 ? '권한 없음: ADMIN/REVIEWER만 승인 가능' : '승인 실패'),
      },
    );
  };

  return (
    <article className="editor">
      <header className="toolbar">
        <div>
          <h1>{doc.title}</h1>
          <p>
            {doc.slug} · <span className="status">{doc.status}</span>
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="보기 모드">
          <button
            aria-selected={mode === 'read'}
            className={mode === 'read' ? 'active' : ''}
            onClick={() => setMode('read')}
            role="tab"
            type="button"
          >
            BlockNote
          </button>
          <button
            aria-selected={mode === 'review'}
            className={mode === 'review' ? 'active' : ''}
            onClick={() => setMode('review')}
            role="tab"
            type="button"
          >
            Diff
          </button>
        </div>
      </header>

      {isReview && (
        <div className="review-actions">
          <label>
            역할:{' '}
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="approve" onClick={onApprove} disabled={approve.isPending}>
            ✅ 승인
          </button>
          <button
            type="button"
            className="reject"
            onClick={() => reject.mutate(doc.id)}
            disabled={reject.isPending}
          >
            반려
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      )}

      {mode === 'read' ? (
        <BlockNotePane markdown={doc.contentMarkdown} editable={doc.status !== 'PUBLISHED'} />
      ) : (
        <Suspense fallback={<div className="panel">Diff loading</div>}>
          <MonacoDiffPane
            original={doc.contentMarkdown}
            modified={doc.draftMarkdown ?? doc.contentMarkdown}
          />
        </Suspense>
      )}
    </article>
  );
}

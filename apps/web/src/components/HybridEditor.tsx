import { lazy, Suspense, useState } from 'react';
import type { DocumentDTO } from '@wf/shared';
import { BlockNotePane } from './blocknote/BlockNotePane.js';

type ViewMode = 'read' | 'review';

const MonacoDiffPane = lazy(async () => {
  const module = await import('./monaco/MonacoDiffPane.js');
  return { default: module.MonacoDiffPane };
});

export function HybridEditor({ doc }: { doc: DocumentDTO }) {
  const [mode, setMode] = useState<ViewMode>(doc.status === 'REVIEW' ? 'review' : 'read');

  return (
    <article className="editor">
      <header className="toolbar">
        <div>
          <h1>{doc.title}</h1>
          <p>{doc.slug}</p>
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

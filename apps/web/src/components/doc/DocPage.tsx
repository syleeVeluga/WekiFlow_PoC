import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useDocument } from '../../api/hooks.js';
import { useKnowledgeItem, usePatchKnowledge } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { isObjectId } from '../../lib/docId.js';
import { BlockNotePane } from '../blocknote/BlockNotePane.js';
import { Badge } from '../common/Primitives.js';

const MonacoDiffPane = lazy(async () => {
  const module = await import('../monaco/MonacoDiffPane.js');
  return { default: module.MonacoDiffPane };
});

const DOC_TABS = ['edit', 'source', 'relations', 'history'] as const;

const TAB_LABELS = {
  edit: '편집',
  source: '소스',
  relations: '연결 관계',
  history: '변경 기록',
} satisfies Record<(typeof DOC_TABS)[number], string>;

export function DocPage() {
  const selectedDocId = useUiStore((s) => s.selectedDocId);
  const isRealDoc = isObjectId(selectedDocId);
  const { data: realDoc } = useDocument(isRealDoc ? selectedDocId : null);
  const { data: doc } = useKnowledgeItem(isRealDoc ? null : selectedDocId);
  const { docTab, setDocTab, openCategory, showToast } = useUiStore();
  const patch = usePatchKnowledge();
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    setDraft(doc?.contentMarkdown ?? null);
  }, [doc?.id, doc?.contentMarkdown]);

  const historyMeta = useMemo(() => {
    if (!doc) return [];
    return [doc.origin, doc.lastChange].filter((item): item is NonNullable<typeof item> => item != null);
  }, [doc]);

  if (isRealDoc) {
    if (!realDoc) return <section className="pg stub"><h1>문서를 선택하세요</h1></section>;
    return (
      <section className="pg doc-page">
        <div className="topbar">
          <div>
            <h1>{realDoc.title}</h1>
            <p><Badge tone="info">{realDoc.status}</Badge> version {realDoc.version}</p>
          </div>
        </div>
        <div className="card doc-body">
          <Suspense fallback={<div className="panel">Diff loading</div>}>
            <MonacoDiffPane original={realDoc.contentMarkdown} modified={realDoc.draftMarkdown ?? realDoc.contentMarkdown} />
          </Suspense>
        </div>
      </section>
    );
  }

  if (!doc) return <section className="pg stub"><h1>문서를 선택하세요</h1></section>;
  const currentMarkdown = draft ?? doc.contentMarkdown;
  const changed = currentMarkdown !== doc.contentMarkdown;
  const save = () => patch.mutate({ id: doc.id, contentMarkdown: currentMarkdown }, { onSuccess: () => showToast('저장했습니다.', 'ok') });

  return (
    <section className="pg doc-page">
      <div className="topbar"><div><h1>{doc.title}</h1><p>{doc.category} · {doc.department}</p></div><button className="btn" onClick={() => openCategory(doc.category)}>← 카테고리로</button></div>
      <div className="doc-toolbar"><div className="tabs">{DOC_TABS.map((tab) => <button className={docTab === tab ? 'on' : ''} onClick={() => setDocTab(tab)} key={tab}>{TAB_LABELS[tab]}</button>)}</div><button className="btn" onClick={() => showToast('챗봇 컨텍스트를 전환했습니다.', 'inf')}>챗봇 토글</button></div>
      <div className="card doc-body">
        {docTab === 'edit' ? (
          <>
            {doc.sourceLabel.includes('Slack') ? <div className="learn-box">AI 학습: Slack 원천에서 감지된 지식입니다.</div> : null}
            <BlockNotePane markdown={doc.contentMarkdown} editable onMarkdownChange={setDraft} />
            <div className="doc-actions">
              <button className="btn-primary" onClick={save} disabled={!changed || patch.isPending}>저장</button>
            </div>
          </>
        ) : docTab === 'source' ? (
          <pre className="markdown-source"><code>{currentMarkdown}</code></pre>
        ) : docTab === 'relations' ? (
          <p>관련 문서: {doc.aiTags.map((tag) => `#${tag}`).join(' ')}</p>
        ) : (
          <>
            <div className="history-meta">{historyMeta.map((item) => <span key={`${item.label}-${item.at}`}>{item.label} · {item.at} · {item.by} · {item.source}</span>)}</div>
            <Suspense fallback={<div className="panel">Diff loading</div>}>
              <MonacoDiffPane original={doc.contentMarkdown} modified={currentMarkdown} />
            </Suspense>
          </>
        )}
      </div>
    </section>
  );
}

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { canEdit } from '@wf/shared';
import { useConnections, useDocument } from '../../api/hooks.js';
import { useKnowledgeItem, usePatchKnowledge } from '../../data/hooks.js';
import { useAuthStore } from '../../auth/store.js';
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

function strengthDots(strength: number): string {
  const filled = Math.min(3, Math.max(1, Math.round(strength * 3)));
  return '●●●'.slice(0, filled) + '○○○'.slice(0, 3 - filled);
}

/**
 * "연결 관계" tab: the facts this document contributed to the knowledge graph plus other
 * documents that mention the same entities — a source-discovery view instead of a node-link graph.
 */
function RelationsView({ docId }: { docId: string }) {
  const { data, isLoading } = useConnections(docId);
  const openDoc = useUiStore((s) => s.openDoc);

  if (isLoading) return <p className="muted">연결 관계를 불러오는 중…</p>;
  const facts = data?.facts ?? [];
  const related = data?.relatedDocs ?? [];
  if (facts.length === 0 && related.length === 0) {
    return <p className="muted">아직 추출된 연결 관계가 없습니다. 그래프 분석이 완료되면 표시됩니다.</p>;
  }

  return (
    <div className="rel-view">
      {facts.length ? (
        <section className="rel-block">
          <div className="dp-sec-label">이 문서가 다루는 핵심 사실</div>
          <ul className="rel-facts">
            {facts.map((fact, index) => (
              <li className="rel-fact" key={`${fact.subject}-${fact.predicate}-${fact.object}-${index}`}>
                <span className="rel-subj">{fact.subject}</span>
                <span className="rel-pred">{fact.predicate}</span>
                <span className="rel-obj">{fact.object}</span>
                <span className="rel-strength" title={`신뢰도 ${Math.round(fact.strength * 100)}%`}>{strengthDots(fact.strength)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {related.length ? (
        <section className="rel-block">
          <div className="dp-sec-label">이 내용이 함께 언급된 문서</div>
          <ul className="rel-docs">
            {related.map((rel) => (
              <li key={rel.documentId}>
                <button type="button" className="rel-doc-row" onClick={() => openDoc(rel.documentId)}>
                  <span className="rel-doc-title">{rel.title}</span>
                  <span className="rel-doc-shared">{rel.sharedEntities.map((entity) => <em className="rel-chip" key={entity}>{entity}</em>)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function DocPage() {
  const selectedDocId = useUiStore((s) => s.selectedDocId);
  // The tree opens materialized wiki items keyed by the document ObjectId, so always resolve the
  // knowledge item first (getKnowledge matches by wiki.id regardless of id shape). Fall back to the
  // read-only real-document view only when no wiki item exists (e.g. a doc still in review).
  const { data: doc } = useKnowledgeItem(selectedDocId);
  const { data: realDoc } = useDocument(isObjectId(selectedDocId) ? selectedDocId : null);
  const { docTab, setDocTab, openCategory, showToast, selectedCategory } = useUiStore();
  const role = useAuthStore((s) => s.user?.role ?? 'VIEWER');
  const editable = canEdit(role);
  const patch = usePatchKnowledge();
  const [draft, setDraft] = useState<string | null>(null);
  // Which revision the 변경 기록 tab has expanded into a diff (null = list only). Reset on doc/tab change.
  const [openRevision, setOpenRevision] = useState<string | null>(null);

  useEffect(() => {
    setDraft(doc?.contentMarkdown ?? null);
  }, [doc?.id, doc?.contentMarkdown]);

  useEffect(() => {
    setOpenRevision(null);
  }, [selectedDocId, docTab]);

  const historyMeta = useMemo(() => {
    if (!doc) return [];
    return [doc.origin, doc.lastChange].filter((item): item is NonNullable<typeof item> => item != null);
  }, [doc]);

  // --- Editable wiki page (the common case: any page opened from the tree / KB) ---
  if (doc) {
    const currentMarkdown = draft ?? doc.contentMarkdown;
    const changed = currentMarkdown !== doc.contentMarkdown;
    const save = () => patch.mutate({ id: doc.id, contentMarkdown: currentMarkdown }, { onSuccess: () => showToast('저장했습니다.', 'ok') });
    const saveBtn = (
      <div className="doc-actions">
        <button className="btn-primary" onClick={save} disabled={!changed || patch.isPending}>저장</button>
      </div>
    );

    return (
      <section className="pg doc-page">
        <div className="topbar"><div><h1>{doc.title}</h1><p>{doc.category} · {doc.department}</p></div><button className="btn" onClick={() => openCategory(doc.category)}>← 카테고리로</button></div>
        <div className="doc-toolbar"><div className="tabs">{DOC_TABS.map((tab) => <button className={docTab === tab ? 'on' : ''} onClick={() => setDocTab(tab)} key={tab}>{TAB_LABELS[tab]}</button>)}</div><button className="btn" onClick={() => showToast('챗봇 컨텍스트를 전환했습니다.', 'inf')}>챗봇 토글</button></div>
        <div className="card doc-body">
          {docTab === 'edit' ? (
            <>
              {doc.sourceLabel.includes('Slack') ? <div className="learn-box">AI 학습: Slack 원천에서 감지된 지식입니다.</div> : null}
              <BlockNotePane markdown={currentMarkdown} editable={editable} onMarkdownChange={setDraft} />
              {editable ? saveBtn : null}
            </>
          ) : docTab === 'source' ? (
            editable ? (
              <>
                <textarea className="markdown-source-edit" value={currentMarkdown} spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
                {saveBtn}
              </>
            ) : (
              <pre className="markdown-source"><code>{currentMarkdown}</code></pre>
            )
          ) : docTab === 'relations' ? (
            <RelationsView docId={doc.id} />
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

  // --- Read-only fallback for real documents without a materialized wiki item (e.g. in review) ---
  if (realDoc) {
    const hasDraft = realDoc.draftMarkdown != null && realDoc.draftMarkdown !== realDoc.contentMarkdown;
    return (
      <section className="pg doc-page">
        <div className="topbar">
          <div>
            <h1>{realDoc.title}</h1>
            <p><Badge tone="info">{realDoc.status}</Badge> version {realDoc.version}</p>
          </div>
          {selectedCategory ? <button className="btn" onClick={() => openCategory(selectedCategory)}>← 카테고리로</button> : null}
        </div>
        <div className="doc-toolbar"><div className="tabs">{DOC_TABS.map((tab) => <button className={docTab === tab ? 'on' : ''} onClick={() => setDocTab(tab)} key={tab}>{TAB_LABELS[tab]}</button>)}</div><button className="btn" onClick={() => showToast('챗봇 컨텍스트를 전환했습니다.', 'inf')}>챗봇 토글</button></div>
        <div className="card doc-body">
          {docTab === 'edit' ? (
            <BlockNotePane markdown={realDoc.draftMarkdown ?? realDoc.contentMarkdown} editable={false} />
          ) : docTab === 'source' ? (
            <pre className="markdown-source"><code>{realDoc.contentMarkdown}</code></pre>
          ) : docTab === 'relations' ? (
            <RelationsView docId={realDoc.id} />
          ) : (
            <div className="doc-history">
              <div className="dp-sec-label">이 문서의 변경 기록</div>
              {hasDraft ? (
                <button type="button" className={`rev-item ${openRevision === 'draft' ? 'on' : ''}`} onClick={() => setOpenRevision(openRevision === 'draft' ? null : 'draft')}>
                  <span className="rev-dot rev-draft" />
                  <span className="rev-body"><span className="rev-action">검토 중 초안 (v{realDoc.version + 1} 예정)</span><span className="rev-meta">현재 발행본과 비교하려면 클릭</span></span>
                </button>
              ) : null}
              <div className="rev-item rev-static">
                <span className="rev-dot rev-current" />
                <span className="rev-body"><span className="rev-action">현재 발행본 (v{realDoc.version})</span><span className="rev-meta">{realDoc.updatedAt}{realDoc.approvedBy ? ` · 승인: ${realDoc.approvedBy}` : ''}</span></span>
              </div>
              {hasDraft ? null : <p className="rev-empty">검토 중인 변경 사항이 없습니다.</p>}
              {openRevision === 'draft' && hasDraft ? (
                <Suspense fallback={<div className="panel">Diff loading</div>}>
                  <MonacoDiffPane original={realDoc.contentMarkdown} modified={realDoc.draftMarkdown!} />
                </Suspense>
              ) : null}
            </div>
          )}
        </div>
      </section>
    );
  }

  return <section className="pg stub"><h1>문서를 선택하세요</h1></section>;
}
